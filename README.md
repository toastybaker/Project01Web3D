# Project 01 Web 3D

Six-player browser game built with React, Three.js, and Colyseus.

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:4173`. The first player in a room is the host.

## Host

```bash
npm ci
npm run build
npm start
```

`npm start` serves the game and multiplayer server from one port (`PORT`, default `4173`). Share the resulting site URL; Hamachi is not required. On a hosting service, use `npm ci && npm run build` as the build command and `npm start` as the start command.

The repository includes a Render Blueprint (`render.yaml`). In Render, create a Blueprint from this repository and keep it at one instance: match rooms currently live in that Node process. The free plan works for short private tests but sleeps between sessions; use Starter when the game should stay ready without a cold start.

For a separately hosted web client and multiplayer server, build the client with `VITE_MULTIPLAYER_URL` set to the public server origin.

See `AGENTS.md` and `docs/DIRECTION.md` for binding product and art direction.
