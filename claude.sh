#!/bin/bash
set -e

INSTANCE="default"

# start VM if not running
STATUS=$(limactl list --json 2>/dev/null | python3 -c "
import sys,json
for line in sys.stdin:
    obj=json.loads(line)
    if obj.get('name')=='$INSTANCE':
        print(obj.get('status',''))
" 2>/dev/null || echo "")

if [ "$STATUS" != "Running" ]; then
    echo "Starting lima instance..."
    limactl start "$INSTANCE"
fi

# ssh with TTY for interactive claude, override BatchMode
# ssh -t -F "$HOME/.lima/$INSTANCE/ssh.config" -o BatchMode=no "lima-$INSTANCE" 'export PATH="$HOME/.local/share/fnm:$PATH" && eval "$(fnm env)" && cd ~/mediavision && exec claude'
ssh -t -F "$HOME/.lima/$INSTANCE/ssh.config" -o BatchMode=no "lima-$INSTANCE" 'export PATH="$HOME/.local/share/fnm:$PATH" && eval "$(fnm env)" && cd ~/mediavision && exec $SHELL'