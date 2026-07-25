const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Explicitly import models
const SupportAgent = require('../models/SupportAgent');
const Ticket = require('../models/Ticket');
const Customer = require('../models/Customer');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');

// File to Model mapping
const fileModelMap = {
  'support_agents.json': SupportAgent,
  'tickets_batch.json': Ticket,
  'ticket_payload_single.json': Ticket,
};

async function seedDatabase() {
  try {
    const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/swiftdesk';
    
    console.log('Connected to MongoDB');
    await mongoose.connect(MONGO_URI);

    const dataPath = path.join(__dirname, '../sample_data');
    
    if (!fs.existsSync(dataPath)) {
      console.log(`[INFO] Data directory not found at: ${dataPath}`);
      return;
    }

    // Provision Admin if not exists
    await User.deleteMany({ role: 'admin' });
    const adminUser = new User({
      fullName: 'System Admin',
      email: 'admin@swiftdesk123.com',
      password: 'Admin@123',
      role: 'admin',
      isActive: true,
    });
    await adminUser.save();
    console.log('Provisioned Admin user (admin@swiftdesk123.com)');

    const files = fs.readdirSync(dataPath).filter(file => file.endsWith('.json'));

    for (const file of files) {
      const Model = fileModelMap[file];
      
      if (!Model) {
        // Ignore JSON files that have no mapping
        continue;
      }
      
      const filePath = path.join(dataPath, file);
      
      try {
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        let data = JSON.parse(fileContent);

        // Custom extraction logic for support_agents.json
        if (file === 'support_agents.json' && data.support_agents) {
          data = data.support_agents;
        }

        // If data is a single object, wrap it in an array
        if (!Array.isArray(data)) {
          data = [data];
        }

        console.log(`Seeding ${Model.modelName}...`);
        
        // Custom transformation logic for Tickets
        if (Model === Ticket) {
          for (let i = 0; i < data.length; i++) {
            const t = data[i];

            // 1. Map external_ref -> ticketId (generate if missing)
            t.ticketId = t.external_ref || `TKT-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

            // 2. Map created_at -> createdAt
            if (t.created_at) {
              t.createdAt = t.created_at;
              delete t.created_at;
            }

            // 3. Defaults
            if (t.priority === null || t.priority === undefined) {
              t.priority = 'Medium';
            }
            if (t.category === null || t.category === undefined) {
              t.category = 'Other';
            }

            // 4. Handle Customer relation
            if (t.customer && t.customer.customer_id) {
              let customerDoc = await Customer.findOne({ customer_id: t.customer.customer_id });
              
              if (!customerDoc) {
                customerDoc = await Customer.create({
                  customer_id: t.customer.customer_id,
                  name: t.customer.name || 'Unknown',
                  email: t.customer.email || `${t.customer.customer_id}@example.com`,
                  password: 'Customer@123',
                });
              }

              // Provision Customer User account if missing
              let userDoc = await User.findOne({ email: customerDoc.email });
              if (!userDoc) {
                userDoc = new User({
                  fullName: customerDoc.name,
                  email: customerDoc.email,
                  password: 'Customer@123',
                  role: 'customer',
                  customer: customerDoc._id,
                  isActive: true,
                });
                await userDoc.save();
              }

              // Replace customer object with ObjectId
              t.customer = customerDoc._id;
            }
          }
        }
        
        // Clear collection
        await Model.deleteMany({});
        
        // Insert data
        if (data.length > 0) {
          const inserted = await Model.insertMany(data);
          console.log(`Inserted ${inserted.length} ${Model.modelName} records`);
          
          if (Model === SupportAgent) {
            console.log('Provisioning Engineer user accounts...');
            await User.deleteMany({ role: 'engineer' });
            
            for (const agent of inserted) {
              const engUser = new User({
                fullName: agent.name,
                email: agent.email,
                password: 'Engineer@123',
                role: 'engineer',
                engineerLevel: agent.level,
                supportAgent: agent._id,
                isActive: true,
              });
              await engUser.save();
            }
            console.log(`Provisioned ${inserted.length} Engineer accounts`);
          }
        } else {
          console.log(`Inserted 0 ${Model.modelName} records (empty file)`);
        }
      } catch (err) {
        // Handle errors gracefully and continue
        console.error(`[ERROR] Failed to seed ${file}: ${err.message}`);
      }
    }

    console.log('Finished successfully');
  } catch (err) {
    console.error('Fatal error during seeding:', err);
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
}

if (require.main === module) {
  seedDatabase().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = seedDatabase;
