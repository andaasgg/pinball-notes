#!/bin/bash
set -e

# ── Backup live data before deploy ───────────────────────────
BACKUP_DIR=~/projects/pinball-notes/.backups
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"
tar -czf "$BACKUP_DIR/data_$TIMESTAMP.tar.gz" -C /var/www/pinball-notes data.json
echo "Backed up data.json → $BACKUP_DIR/data_$TIMESTAMP.tar.gz"

# Keep only the 30 most recent backups
ls -tp "$BACKUP_DIR"/data_*.tar.gz | tail -n +31 | xargs -r rm --

# ── Deploy ────────────────────────────────────────────────────
git pull
rsync -av --no-group --no-owner \
  --exclude='.git' \
  --exclude='deploy.sh' \
  --exclude='notes.andaas.org.conf' \
  --exclude='tokens.json' \
  --exclude='data.json' \
  ~/projects/pinball-notes/ /var/www/pinball-notes/
