
echo "==> Building frontend..."
(cd "./frontend" && npm i && npm run build)

echo "==> Syncing frontend dist..."
rsync -az "./frontend/dist/" "rock@mediavision:/opt/rock/frontend/dist/"

echo "==> Syncing node backend..."
rsync -az --exclude 'node_modules' --exclude 'sqlite/build' --exclude 'package.json' --exclude '*.node' \
    "./node/" "rock@mediavision:/opt/rock/node/"

echo "==> Syncing template ..."
#rsync -az "./template/" "rock@mediavision:/opt/rock/template/"
#rsync -az "./skills/" "rock@mediavision:/opt/rock/skills/"

#echo "==> Installing node deps on server..."
# ssh mediavision "cd /opt/rock/node && npm install --omit=dev"

echo "==> Syncing database ..."
# rsync -az "mediavision.db" "rock@mediavision:/opt/rock/"

echo "==> Restart service ..."
ssh mediavision "systemctl restart rock"


# echo "==> Syncing .env if exists..."
# if [ -f "$SCRIPT_DIR/.env" ]; then
#     rsync -az "$SCRIPT_DIR/.env" "mediavision:/opt/rock/.env"
# fi