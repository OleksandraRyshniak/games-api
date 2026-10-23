
require('dotenv').config();

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/user');

async function seedUsers() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        const users = [
            { username: 'user', password: 'user123', role: 'user' },
            { username: 'admin', password: 'admin123', role: 'admin' }
        ];

        for (const user of users) {
            const existingUser = await User.findOne({
                username: user.username
            });

            if (!existingUser) {
                const passwordHash = await bcrypt.hash(user.password, 12);

                await User.create({
                    username: user.username,
                    passwordHash,
                    role: user.role
                });

                console.log(`Created: ${user.username}`);
            }
        }

        console.log('Users created successfully');
    } catch (error) {
        console.error(error);
    } finally {
        await mongoose.disconnect();
    }
}

seedUsers();
