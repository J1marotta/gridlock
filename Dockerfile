FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY src/multiplayer/protocol.js ./src/multiplayer/protocol.js
COPY src/game/track.js ./src/game/track.js
COPY src/game/tune.js ./src/game/tune.js

USER node
EXPOSE 8080
CMD ["npm", "run", "start:colyseus"]
