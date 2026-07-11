#!/usr/bin/env node
/**
 * Seed script for demo/test users in Krewe Mystique DB
 * Run: node seed.js
 */
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const demoUsers = [
  { email: 'demo@krewe.local', full_name: 'Demo Member', role: 'member', password: 'demo123' },
  { email: 'admin@krewe.local', full_name: 'Admin User', role: 'admin', password: 'admin123' },
];

async function seed() {
  try {
    console.log('🌱 Seeding demo users...');
    for (const user of demoUsers) {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync(user.password, salt);
      const result = await pool.query(
        'INSERT INTO users (email, full_name, role, password_hash) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING id, email, role',
        [user.email, user.full_name, user.role, hash]
      );
      if (result.rowCount > 0) {
        console.log(`✓ Created ${user.role}: ${user.email} (password: ${user.password})`);
      } else {
        console.log(`✓ ${user.email} already exists`);
      }
    }
    console.log('✅ Seed complete!');
  } catch (error) {
    console.error('❌ Seed failed:', error.message);
  } finally {
    await pool.end();
  }
}

seed();
