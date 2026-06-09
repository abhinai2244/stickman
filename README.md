# Ragdoll Archers

A browser multiplayer ragdoll bow game with a waiting room, host-controlled match settings, player names, and spectator support.

## Run

```bash
npm install
npm start
```

Open `http://localhost:8080` in two or more browser windows or tabs.

## How the lobby works

- The room creator becomes the host.
- Each player can set a display name from the main menu.
- The waiting room shows everyone who joined and labels them as `HOST`, `PLAYER`, or `SPECTATOR`.
- The host can adjust match settings and start the round.
- If the lobby is full, additional joiners become spectators.

## Notes

- Names are saved locally in the browser.
- Spectators can watch the waiting room and the match, but cannot control a fighter.
- If the server port is already in use, stop the other process or set `PORT` before starting.
