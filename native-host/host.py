#!/usr/bin/env python3
"""Event Lens native messaging host — adds events directly to macOS Calendar.app via JXA."""

import sys
import json
import struct
import subprocess
import shlex


def read_message():
    raw = sys.stdin.buffer.read(4)
    if not raw:
        sys.exit(0)
    length = struct.unpack('<I', raw)[0]
    return json.loads(sys.stdin.buffer.read(length))


def write_message(obj):
    encoded = json.dumps(obj).encode()
    sys.stdout.buffer.write(struct.pack('<I', len(encoded)) + encoded)
    sys.stdout.buffer.flush()


def parse_ts(date, time, timezone):
    """Convert a YYYY-MM-DD HH:MM string in the given IANA timezone to a Unix timestamp."""
    cmd = (
        f'TZ={shlex.quote(timezone)} '
        f'date -j -f "%Y-%m-%dT%H:%M" '
        f'{shlex.quote(date + "T" + time)} +%s'
    )
    r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        raise ValueError(f'date parse error: {r.stderr.strip()}')
    return int(r.stdout.strip())


def add_event(event, alerts):
    title    = str(event.get('title') or 'Untitled Event')
    date     = str(event.get('date') or '')
    start    = str(event.get('start_time') or '09:00')
    end      = str(event.get('end_time') or '10:00')
    tz       = str(event.get('timezone') or 'America/Los_Angeles')
    location = str(event.get('location') or '')
    meeting  = str(event.get('meeting_url') or '')
    desc     = str(event.get('description') or '')
    if meeting:
        desc = (desc + '\n' + meeting).strip()

    start_ts = parse_ts(date, start, tz)
    end_ts   = parse_ts(date, end, tz)

    # Build alarm JS: triggerInterval is seconds before event (negative value)
    alerts_json = json.dumps([int(m) for m in (alerts or [])])

    jxa = f"""
var app = Application('Calendar');
var cals = app.calendars.whose({{writable: true}})();
if (!cals.length) throw new Error('No writable calendar found in Calendar.app');
var cal = cals[0];
var ev = app.Event({{
  summary:   {json.dumps(title)},
  startDate: new Date({start_ts} * 1000),
  endDate:   new Date({end_ts} * 1000)
}});
cal.events.push(ev);
ev.location    = {json.dumps(location)};
ev.description = {json.dumps(desc)};
{alerts_json}.forEach(function(m) {{
  try {{
    ev.make({{new: 'DisplayAlarm', withProperties: {{triggerInterval: -(m * 60)}}}});
  }} catch(e) {{}}
}});
app.activate();
'ok'
"""
    r = subprocess.run(
        ['osascript', '-l', 'JavaScript', '-e', jxa],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or r.stdout.strip())


def main():
    while True:
        try:
            msg = read_message()
            if msg.get('action') == 'addEvent':
                add_event(msg['event'], msg.get('alerts', []))
                write_message({'success': True})
            else:
                write_message({'success': False, 'error': f"unknown action: {msg.get('action')}"})
        except BrokenPipeError:
            sys.exit(0)
        except Exception as e:
            write_message({'success': False, 'error': str(e)})


if __name__ == '__main__':
    main()
