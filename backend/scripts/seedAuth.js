const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
require('dotenv').config();

const User = require('../models/User');
const SupportAgent = require('../models/SupportAgent');

// Fallback to local DB if not defined
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/swiftdesk';

const adminSeed = {
  full_name: 'Admin User',
  email: 'admin@swiftdesk.local',
  password_hash: 'admin123',
  role: 'admin',
  engineer_level: null,
};

const engineersSeed = [
  {
    full_name: 'Alice Firstline',
    email: 'alice@swiftdesk.local',
    password_hash: 'engineer123',
    role: 'engineer',
    engineer_level: 'L1',
    agent_id: 'AGT-L1-01',
    skills: ['General', 'Billing'],
    department: 'Support',
    max_capacity: 10,
  },
  {
    full_name: 'Bob Resolver',
    email: 'bob@swiftdesk.local',
    password_hash: 'engineer123',
    role: 'engineer',
    engineer_level: 'L2',
    agent_id: 'AGT-L2-01',
    skills: ['Technical', 'General'],
    department: 'Technical',
    max_capacity: 5,
  },
  {
    full_name: 'Charlie Escalation',
    email: 'charlie@swiftdesk.local',
    password_hash: 'engineer123',
    role: 'engineer',
    engineer_level: 'L3',
    agent_id: 'AGT-L3-01',
    skills: ['Technical', 'Network', 'Database'],
    department: 'Engineering',
    max_capacity: 3,
  },
];

async function seed() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('Connected.');

    console.log('Clearing existing Users and SupportAgents...');
    await User.deleteMany({});
    await SupportAgent.deleteMany({});

    // Create Admin
    const admin = new User(adminSeed);
    await admin.save();
    console.log(`Created admin: ${admin.email}`);

    // Create Engineers
    for (const eng of engineersSeed) {
      // 1. Create Identity User
      const user = new User({
        full_name: eng.full_name,
        email: eng.email,
        password_hash: eng.password_hash,
        role: eng.role,
        engineer_level: eng.engineer_level,
      });

      // 2. Create SupportAgent for assignment engine
      const agent = await SupportAgent.create({
        agent_id: eng.agent_id,
        name: eng.full_name,
        email: eng.email,
        level: eng.engineer_level,
        skills: eng.skills,
        department: eng.department,
        max_capacity: eng.max_capacity,
        status: 'available',
      });

      // 3. Link User to SupportAgent
      user.linked_id = agent._id;
      await user.save();
      console.log(`Created engineer: ${user.email} (${user.engineer_level})`);
    }

    console.log('Seeding completed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

seed();
