
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const yamljs = require('yamljs');
const crypto = require('crypto');
require('dotenv').config();
const mongoose = require('mongoose');
const game = require('./models/game');
const User = require('./models/user');
const bcrypt = require('bcryptjs');

const app = express();
const port = 8080;

const swaggerDocument = yamljs.load('./docs/swagger.yaml');

app.use(express.json());

const sessions = new Map();

async function getBasicUser(req) {
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

    const foundUser = await User.findOne({ username });

    if (!foundUser) return null;

    const isValid = await bcrypt.compare(
        password,
        foundUser.passwordHash
    );

    if (!isValid) return null;

    return {
        username: foundUser.username,
        role: foundUser.role
    };
}


function getSessionUser(req) {
    const header = req.headers.authorization || '';

    if (!header.startsWith('Bearer ')) {
        return null;
    }

    const token = header.slice(7);
    return sessions.get(token) || null;
}

async function getUser(req) {
    return getSessionUser(req) || await getBasicUser(req);
}


function auth(roles) {
    return async (req, res, next) => {
        try {
            const currentUser = await getUser(req);

            if (!currentUser) {
                return res.status(401).json({
                    error: 'Authentication required'
                });
            }

            if (!roles.includes(currentUser.role)) {
                return res.status(403).json({
                    error: 'Forbidden'
                });
            }

            req.user = currentUser;
            next();

        } catch (error) {
            res.status(500).json({
                error: 'Authentication error'
            });
        }
    };
}



app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};

        if (
            typeof username !== 'string' ||
            typeof password !== 'string'
        ) {
            return res.status(401).json({
                error: 'Invalid username or password'
            });
        }

        const foundUser = await User.findOne({ username });

        if (!foundUser) {
            return res.status(401).json({
                error: 'Invalid username or password'
            });
        }

        const isValid = await bcrypt.compare(
            password,
            foundUser.passwordHash
        );

        if (!isValid) {
            return res.status(401).json({
                error: 'Invalid username or password'
            });
        }

        const token = crypto.randomBytes(32).toString('hex');

        sessions.set(token, {
            username: foundUser.username,
            role: foundUser.role
        });

        return res.json({
            token,
            username: foundUser.username,
            role: foundUser.role
        });

    } catch (error) {
        console.error('Login error:', error);

        return res.status(500).json({
            error: 'Authentication error'
        });
    }
});


app.post('/logout', (req, res) => {
    const header = req.headers.authorization || '';

    if (header.startsWith('Bearer ')) {
        sessions.delete(header.slice(7));
    }

    res.status(204).send();
});


app.get('/games/summary', async (req, res) => {
    try {
        const games = await game.find();

        const totalGames = games.length;

        const totalPrice = games.reduce(
            (sum, g) => sum + g.price, 0
        );

        const averagePrice = totalGames > 0
            ? totalPrice / totalGames
            : 0;

        res.status(200).json({
            totalGames,
            averagePrice: Number(averagePrice.toFixed(2))
        });

    } catch (error) {
        res.status(500).json({
            error: 'Database error'
        });
    }
});

app.get('/games', async (req, res) => {
    try {
        const games = await game.find({}, { _id: 0, __v: 0 });
        res.status(200).json(games);
    } catch (error) {
        res.status(500).json({
            error: 'Database error'
        });
    }
});

app.get('/games/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({
                error: 'Invalid game ID'
            });
        }

        const foundGame = await game.findOne(
            { id: id },
            { _id: 0, __v: 0 }
        );

        if (!foundGame) {
            return res.status(404).json({
                error: 'Game not found'
            });
        }

        res.status(200).json(foundGame);
    } catch (error) {
        res.status(500).json({
            error: 'Database error'
        });
    }
});

app.post('/games', auth(['user', 'admin']), async (req, res) => {
    try {
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

        const existingGame = await game.findOne({
            name: cleanName
        }).collation({ locale: 'en', strength: 2 });

        if (existingGame) {
            return res.status(409).json({
                error: 'Game with this name already exists'
            });
        }

        const lastGame = await game.findOne().sort({ id: -1 });
        const nextGameId = lastGame ? lastGame.id + 1 : 1;

        const newGame = await game.create({
            id: nextGameId,
            name: cleanName,
            price: price
        });

        res.status(201)
            .location(`${getBaseUrl(req)}/games/${newGame.id}`)
            .json({
                id: newGame.id,
                name: newGame.name,
                price: newGame.price
            });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                error: 'Game with this name or ID already exists'
            });
        }

        res.status(500).json({
            error: 'Database error'
        });
    }
});


app.put('/games/:id', auth(['admin']), async (req, res) => {
    try {
        const id = Number(req.params.id);
        const { name, price } = req.body || {};

        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({
                error: 'Invalid game ID'
            });
        }

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

        const existingGame = await game.findOne({ id });

        if (!existingGame) {
            return res.status(404).json({
                error: 'Game not found'
            });
        }

        existingGame.name = name.trim();
        existingGame.price = price;

        await existingGame.save();

        res.status(200).json({
            id: existingGame.id,
            name: existingGame.name,
            price: existingGame.price
        });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                error: 'Game with this name already exists'
            });
        }

        res.status(500).json({
            error: 'Database error'
        });
    }
});


app.delete('/games/:id', auth(['admin']), async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id < 1) {
            return res.status(400).json({
                error: 'Invalid game ID'
            });
        }

        const deletedGame = await game.findOneAndDelete({ id });

        if (!deletedGame) {
            return res.status(404).json({
                error: 'Game not found'
            });
        }

        res.status(204).send();

    } catch (error) {
        res.status(500).json({
            error: 'Database error'
        });
    }
});



app.get('/docs/swagger.json', async (req, res) => {
    try {
        const currentUser = await getUser(req);
        const role = currentUser ? currentUser.role : 'guest';

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

    } catch (error) {
        res.status(500).json({
            error: 'Authentication error'
        });
    }
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

            .swagger-ui .authorization__btn {
                display: none !important;
            }
        `,
        customJsStr: customJs
    })
);



async function startServer() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        console.log('MongoDB Atlas connected');

        app.listen(port, () => {
            console.log(`API up at: http://localhost:${port}`);
        });
    } catch (error) {
        console.error('MongoDB connection failed:', error.message);
        process.exit(1);
    }
}

startServer();



function getBaseUrl(req) {
    return `${req.protocol}://${req.get('host')}`;
}
