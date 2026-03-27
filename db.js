const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'database', 'shetmaal.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to SQLite database');
  }
});

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  mobile TEXT UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('farmer', 'buyer')),
  address TEXT,
  location TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS crops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT DEFAULT 'किलो',
  price REAL NOT NULL,
  quality TEXT,
  location TEXT,
  description TEXT,
  image_path TEXT,
  video_path TEXT,
  qr_code_path TEXT,
  stock REAL NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  crop_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  UNIQUE(user_id, crop_id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(crop_id) REFERENCES crops(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  total REAL NOT NULL,
  status TEXT DEFAULT 'confirmed',
  payment_method TEXT NOT NULL,
  delivery_type TEXT NOT NULL,
  delivery_address TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  crop_id INTEGER NOT NULL,
  farmer_id INTEGER NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id),
  FOREIGN KEY(crop_id) REFERENCES crops(id),
  FOREIGN KEY(farmer_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS market_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  crop_name TEXT NOT NULL,
  price REAL NOT NULL,
  market_location TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  crop_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  farmer_id INTEGER NOT NULL,
  rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id),
  FOREIGN KEY(crop_id) REFERENCES crops(id),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(farmer_id) REFERENCES users(id)
);

`);

// Add qr_code_path column if it doesn't exist
try {
  db.prepare('SELECT qr_code_path FROM crops LIMIT 1').get();
} catch (e) {
  if (e.message.includes('no such column')) {
    db.prepare('ALTER TABLE crops ADD COLUMN qr_code_path TEXT').run();
    console.log('✓ Added qr_code_path column to crops table');
  }
}

const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
if (userCount === 0) {
  const farmerPassword = bcrypt.hashSync('farmer123', 10);
  const buyerPassword = bcrypt.hashSync('buyer123', 10);

  const insertUser = db.prepare(`
    INSERT INTO users (name, email, mobile, password, role, address, location)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const farmer = insertUser.run(
    'राम पाटील',
    'farmer@example.com',
    '9999991111',
    farmerPassword,
    'farmer',
    'शेती रोड, नाशिक',
    'नाशिक'
  );

  insertUser.run(
    'सुरेश शहा',
    'buyer@example.com',
    '9999992222',
    buyerPassword,
    'buyer',
    'मार्केट यार्ड, पुणे',
    'पुणे'
  );

  const insertCrop = db.prepare(`
    INSERT INTO crops (user_id, name, category, quantity, unit, price, quality, location, description, stock, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `);

  insertCrop.run(farmer.lastInsertRowid, 'कांदा', 'भाज्या', 120, 'किलो', 22, 'A ग्रेड', 'नाशिक', 'ताजा लाल कांदा', 120);
  insertCrop.run(farmer.lastInsertRowid, 'टोमॅटो', 'भाज्या', 80, 'किलो', 30, 'A ग्रेड', 'नाशिक', 'ताजे टोमॅटो', 80);
  insertCrop.run(farmer.lastInsertRowid, 'गहू', 'धान्य', 200, 'किलो', 29, 'प्रिमियम', 'अहमदनगर', 'स्वच्छ आणि चांगल्या दर्जाचा गहू', 200);
}

const marketCount = db.prepare('SELECT COUNT(*) as count FROM market_prices').get().count;
if (marketCount === 0) {
  const insertPrice = db.prepare('INSERT INTO market_prices (crop_name, price, market_location) VALUES (?, ?, ?)');
  [
    ['कांदा', 20, 'पुणे'],
    ['टोमॅटो', 30, 'नाशिक'],
    ['गहू', 28, 'अहमदनगर'],
    ['बटाटा', 25, 'सोलापूर'],
    ['मका', 24, 'जळगाव'],
    ['द्राक्षे', 60, 'सांगली'],
    ['केळी', 40, 'कोल्हापूर'],
    ['आंबा', 80, 'रत्नागिरी'],
    ['संत्रा', 50, 'नागपूर'],
    ['कापूस', 70, 'अकोला']
  ].forEach(row => insertPrice.run(...row));
}

module.exports = db;
