# Games API

Simple REST API for games, built with Node.js and Express. Data is stored in memory.

## Run

```bash
npm install
node .
```

Server: http://localhost:8080
Swagger docs: http://localhost:8080/docs

## Endpoints

| Method | Endpoint      | Description    |
|--------|---------------|----------------|
| GET    | `/games`      | Get all games  |
| GET    | `/games/{id}` | Get one game   |
| POST   | `/games`      | Add a game     |
| DELETE | `/games/{id}` | Delete a game  |

Example body for POST:

```json
{ "name": "Tetris", "price": 0.99 }
```