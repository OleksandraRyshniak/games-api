
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const yamljs = require('yamljs');
const crypto = require('crypto');

const app = express();
const port = 8080;

const swaggerDocument = yamljs.load('./docs/swagger.yaml');

app.use(express.json());



const games = [
    { id: 1, name: "Witcher 3", price: 29.99 },
    { id: 2, name: "Cyberpunk 2077", price: 59.99 },
    { id: 3, name: "Minecraft", price: 26.99 },
    { id: 4, name: "Counter-Strike: Global Offensive", price: 0 },
    { id: 5, name: "Roblox", price: 0 },
    { id: 6, name: "Grand Theft Auto V", price: 29.99 },
    { id: 7, name: "Valorant", price: 0 },
    { id: 8, name: "Forza Horizon 5", price: 59.99 }
];

let nextId = Math.max(...games.map(g => g.id)) + 1;

const users = [
    { username: 'user', password: 'user123', role: 'user' },
    { username: 'admin', password: 'admin123', role: 'admin' }
];

const sessions = new Map();


function getBasicUser(req) {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Basic ')) {
        return null;
    }

    const decoded = Buffer.from(
        header.slice(6), 'base64'
    ).toString('utf8');

    const separator = decoded.indexOf(':');

    if (separator === -1) return null;

    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);

    return users.find(u =>
        u.username === username &&
        u.password === password
    ) || null;
}

function getSessionUser(req) {
    const header = req.headers.authorization || '';

    if (!header.startsWith('Bearer ')) {
        return null;
    }

    const token = header.slice(7);
    return sessions.get(token) || null;
}

function getUser(req) {
    return getSessionUser(req) || getBasicUser(req);
}

function auth(roles) {
    return (req, res, next) => {
        const user = getUser(req);

        if (!user) {
            return res.status(401).json({
                error: 'Authentication required'
            });
        }

        if (!roles.includes(user.role)) {
            return res.status(403).json({
                error: 'Forbidden'
            });
        }

        req.user = user;
        next();
    };
}

app.post('/login', (req, res) => {
    const { username, password } = req.body || {};

    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(401).json({
            error: 'Invalid username or password'
        });
    }

    const user = users.find(u =>
        u.username === username &&
        u.password === password
    );

    if (!user) {
        return res.status(401).json({
            error: 'Invalid username or password'
        });
    }

    const token = crypto.randomBytes(32).toString('hex');

    sessions.set(token, { username: user.username, role: user.role });

    res.json({ token, username: user.username, role: user.role });
});
app.post('/logout', (req, res) => {
    const header = req.headers.authorization || '';

    if (header.startsWith('Bearer ')) {
        sessions.delete(header.slice(7));
    }

    res.status(204).send();
});


app.get('/games/summary', (req, res) => {
    res.status(200).json({
        total: games.length,
        totalPrice: Number(
            games.reduce((sum, g) => sum + g.price, 0).toFixed(2)
        ),
        games: games
    });
});


app.get('/games', (req, res) => {
    res.status(200).json(games);
});


app.get('/games/:id', (req, res) => {
    const game = games.find(g =>
        g.id === Number(req.params.id)
    );

    if (!game) {
        return res.status(404).json({
            error: 'Game not found'
        });
    }

    res.status(200).json(game);
});


app.post('/games', auth(['user', 'admin']), (req, res) => {
    const { name, price } = req.body || {};

    if (
        typeof name !== 'string' ||
        !name.trim() ||
        typeof price !== 'number' ||
        !Number.isFinite(price) ||
        price < 0
    ) {
        return res.status(400).json({
            error: 'Invalid or missing name or price'
        });
    }

    const cleanName = name.trim();

    if (games.some(g =>
        g.name.toLowerCase() === cleanName.toLowerCase()
    )) {
        return res.status(409).json({
            error: 'Game with this name already exists'
        });
    }

    const game = {
        id: nextId++,
        name: cleanName,
        price: price
    };

    games.push(game);

    res.status(201)
        .location(`${getBaseUrl(req)}/games/${game.id}`)
        .json(game);
});


app.put('/games/:id', auth(['admin']), (req, res) => {
    const game = games.find(g =>
        g.id === Number(req.params.id)
    );

    if (!game) {
        return res.status(404).json({
            error: 'Game not found'
        });
    }

    const { name, price } = req.body || {};

    if (
        typeof name !== 'string' ||
        !name.trim() ||
        typeof price !== 'number' ||
        !Number.isFinite(price) ||
        price < 0
    ) {
        return res.status(400).json({
            error: 'Invalid or missing name or price'
        });
    }

    const cleanName = name.trim();

    if (games.some(g =>
        g.id !== game.id &&
        g.name.toLowerCase() === cleanName.toLowerCase()
    )) {
        return res.status(409).json({
            error: 'Game with this name already exists'
        });
    }

    game.name = cleanName;
    game.price = price;

    res.status(200).json(game);
});


app.delete('/games/:id', auth(['admin']), (req, res) => {
    const index = games.findIndex(g =>
        g.id === Number(req.params.id)
    );

    if (index === -1) {
        return res.status(404).json({
            error: 'Game not found'
        });
    }

    games.splice(index, 1);
    res.status(204).send();
});


app.get('/docs/swagger.json', (req, res) => {
    const user = getUser(req);
    const role = user ? user.role : 'guest';

    const doc = JSON.parse(JSON.stringify(swaggerDocument));

    if (role === 'guest') {
        delete doc.paths['/games'].post;
        delete doc.paths['/games/{id}'].put;
        delete doc.paths['/games/{id}'].delete;
    } else if (role === 'user') {
        delete doc.paths['/games/{id}'].put;
        delete doc.paths['/games/{id}'].delete;
    }

    res.set('Cache-Control', 'no-store');
    res.json(doc);
});


const customJs = `
(function () {
    let token = null;
    let busy = false;
    let statusText = 'Guest';

    function getSwaggerUI() {
        return window.ui;
    }

    function installInterceptor() {
        const ui = getSwaggerUI();
        if (!ui) return;

        ui.getConfigs().requestInterceptor = function (req) {
            req.headers = req.headers || {};

            if (token) {
                req.headers.Authorization = 'Bearer ' + token;
            } else {
                delete req.headers.Authorization;
                delete req.headers.authorization;
            }

            return req;
        };
    }

    function refreshSwagger() {
        const ui = getSwaggerUI();
        if (!ui) return;

        installInterceptor();
        ui.specActions.updateUrl('/docs/swagger.json');
        ui.specActions.download('/docs/swagger.json');
    }

    function showStatus() {
        const wrapper = document.querySelector('.auth-wrapper');
        if (!wrapper) return;

        let span = document.getElementById('loginStatus');

        if (!span) {
            span = document.createElement('span');
            span.id = 'loginStatus';
            span.style.cssText = 'margin-right:12px;font-weight:bold;';
            wrapper.insertBefore(span, wrapper.firstChild);
        }

        span.textContent = statusText;
    }

    async function checkAuth() {
        const ui = getSwaggerUI();

        if (!ui || !ui.authSelectors || busy) return;

        const authorized = ui.authSelectors.authorized();
        const basic = authorized && authorized.get('basicAuth');

        // Пользователь ввёл данные в окне Authorize
        if (basic && !token) {
            busy = true;

            try {
                const creds = basic.toJS().value || {};

                const response = await fetch('/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: creds.username,
                        password: creds.password
                    })
                });

                if (response.ok) {
                    const data = await response.json();

                    token = data.token;
                    statusText = 'Logged in as ' + data.username + ' (' + data.role + ')';

                    installInterceptor();
                    refreshSwagger();
                } else {
                    ui.authActions.logout(['basicAuth']);
                    statusText = 'Guest';
                    alert('Invalid username or password');
                }
            } catch (error) {
                ui.authActions.logout(['basicAuth']);
                statusText = 'Guest';
            }

            busy = false;
        }

       
        if (!basic && token) {
            busy = true;

            const oldToken = token;
            token = null;
            statusText = 'Guest';

            try {
                await fetch('/logout', {
                    method: 'POST',
                    headers: { Authorization: 'Bearer ' + oldToken }
                });
            } catch (error) {
                console.error(error);
            }

            refreshSwagger();
            busy = false;
        }

        showStatus();
    }

    setInterval(checkAuth, 300);
})();
`;


app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(null, {
        swaggerOptions: {
            url: '/docs/swagger.json',
            persistAuthorization: false
        },
        customCss: `
            .swagger-ui .dialog-ux .modal-ux-header h3 { font-size: 0; }
            .swagger-ui .dialog-ux .modal-ux-header h3::before {
                content: 'Sign in';
                font-size: 24px;
            }

            .swagger-ui .dialog-ux .modal-ux-content h4 { font-size: 0; }
            .swagger-ui .dialog-ux .modal-ux-content h4::before {
                content: 'Games API account';
                font-size: 20px;
            }
        `,
        customJsStr: customJs
    })
);


app.listen(port, () => {
    console.log(`API up at: http://localhost:${port}`);
    console.log(`Swagger: http://localhost:${port}/docs`);
});



function getBaseUrl(req) {
    return `${req.protocol}://${req.get('host')}`;
}
