require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Ticket = require('./models/Ticket');
const Customer = require('./models/Customer');

async function seedSynthetic() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');

        const dataPath = path.join(__dirname, '../ml-service/synthetic_tickets.json');
        const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

        let customer = await Customer.findOne();
        if (!customer) {
            customer = await Customer.create({
                customer_id: 'CUS-TEST',
                name: 'Test Customer',
                email: 'test@example.com',
                password: 'test'
            });
        }

        const tickets = data.map((t, idx) => ({
            ticketId: `SYN-${Date.now()}-${idx}`,
            customer: customer._id,
            subject: t.subject,
            description: t.description,
            category: t.finalCategory, // we don't care much about original category since ML only looks at text and finalCategory
            priority: t.finalPriority,
            status: 'Resolved',
            finalCategory: t.finalCategory,
            finalPriority: t.finalPriority,
            channel: 'web'
        }));

        const result = await Ticket.insertMany(tickets);
        console.log(`Inserted ${result.length} synthetic tickets`);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

seedSynthetic();
