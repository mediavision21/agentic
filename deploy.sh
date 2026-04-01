
echo "==> Syncing backend..."
rsync -az --exclude '__pycache__' --exclude '.venv' \
    "./backend/" "rock@mediavision:/opt/rock/backend/"

echo "==> Building frontend..."
(cd "./frontend" && npm i && npm run build)

echo "==> Syncing frontend dist..."
rsync -az "./frontend/dist/" "rock@mediavision:/opt/rock/frontend/dist/"

echo "==> Syncing database ..."
# rsync -az "mediavision.db" "rock@mediavision:/opt/rock/"

ssh mediavision "sudo systemctl restart rock"


# echo "==> Syncing .env if exists..."
# if [ -f "$SCRIPT_DIR/.env" ]; then
#     rsync -az "$SCRIPT_DIR/.env" "mediavision:/opt/rock/.env"
# fi