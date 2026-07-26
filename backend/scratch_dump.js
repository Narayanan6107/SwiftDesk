const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const Ticket = require('./models/Ticket');
const SupportAgent = require('./models/SupportAgent');

async function dump() {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/swiftdesk';
  await mongoose.connect(MONGO_URI);
  
  const totalOpenTickets = await Ticket.countDocuments({ status: { $nin: ['Resolved', 'Closed'] } });
  const assignedTickets = await Ticket.countDocuments({ status: { $nin: ['Resolved', 'Closed'] }, assignedAgent: { $ne: null } });
  const unassignedTickets = await Ticket.countDocuments({ status: { $nin: ['Resolved', 'Closed'] }, assignedAgent: null });
  const queuedTickets = await Ticket.countDocuments({ isQueued: true });

  console.log('--- ASSIGNMENT STATUS ---');
  console.log(`totalOpenTickets: ${totalOpenTickets}`);
  console.log(`assignedTickets: ${assignedTickets}`);
  console.log(`unassignedTickets: ${unassignedTickets}`);
  console.log(`queuedTickets: ${queuedTickets}`);
  
  const agents = await SupportAgent.find({});
  console.log('--- AGENTS ---');
  agents.forEach(a => {
    console.log(`${a.name} (${a.level}): active_tickets = ${a.active_tickets}, status = ${a.status}`);
  });
  
  await mongoose.disconnect();
}

dump().catch(console.error);
