const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
// SMS फिचर तात्पुरता काढलेले - पूर्वी Twilio वापर
require('dotenv').config();
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
    filename: (req, file, cb) => {
      const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, unique + path.extname(file.originalname));
    }
  }),
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'image' && file.mimetype.startsWith('image/')) return cb(null, true);
    if (file.fieldname === 'video' && file.mimetype.startsWith('video/')) return cb(null, true);
    if (file.fieldname === 'qr_code' && file.mimetype.startsWith('image/')) return cb(null, true);
    return cb(new Error('फक्त लाईव्ह फोटो, व्हिडिओ किंवा QR कोड अपलोड करता येईल.'));
  },
  limits: {
    files: 3,
    fileSize: 50 * 1024 * 1024
  }
});

const cropUploadFields = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'video', maxCount: 1 }, { name: 'qr_code', maxCount: 1 }]);

function handleCropUpload(req, res, next) {
  cropUploadFields(req, res, (err) => {
    if (err) {
      setMessage(req, 'error', err.message || 'फोटो / व्हिडिओ अपलोड करण्यात त्रुटी आली.');
      return res.redirect(req.originalUrl.includes('/edit/') ? `/farmer/crops/edit/${req.params.id}` : '/farmer/crops/new');
    }
    next();
  });
}

function formatInvoiceNumber(orderId) {
  return `INV-${String(orderId).padStart(6, '0')}`;
}

function getBuyerInvoice(orderId, buyerId) {
  const order = db.prepare(`
    SELECT orders.*, users.name as buyer_name, users.email as buyer_email, users.mobile as buyer_mobile,
           users.address as buyer_address, users.location as buyer_location
    FROM orders
    JOIN users ON users.id = orders.user_id
    WHERE orders.id = ? AND orders.user_id = ?
  `).get(orderId, buyerId);

  if (!order) return null;

  const items = db.prepare(`
    SELECT order_items.quantity, order_items.price,
           crops.name as crop_name, crops.unit,
           farmers.name as farmer_name, farmers.mobile as farmer_mobile, farmers.location as farmer_location
    FROM order_items
    JOIN crops ON crops.id = order_items.crop_id
    JOIN users as farmers ON farmers.id = order_items.farmer_id
    WHERE order_items.order_id = ?
    ORDER BY order_items.id ASC
  `).all(orderId);

  return {
    order,
    items,
    invoiceNumber: formatInvoiceNumber(order.id)
  };
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(session({
  secret: 'shetmaal-bazaar-secret',
  resave: false,
  saveUninitialized: false
}));

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.message = req.session.message || null;
  delete req.session.message;
  next();
});

function setMessage(req, type, text) {
  req.session.message = { type, text };
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    setMessage(req, 'error', 'कृपया आधी लॉगिन करा.');
    return res.redirect('/login');
  }
  next();
}

function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      setMessage(req, 'error', 'तुम्हाला या पानासाठी परवानगी नाही.');
      return res.redirect('/');
    }
    next();
  };
}

// Twilio SMS Configuration (optional)
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
let twilioClient = null;
if (accountSid && authToken) {
  const twilio = require('twilio');
  twilioClient = twilio(accountSid, authToken);
}

async function sendSMS(mobileNumber, message) {
  if (!mobileNumber) return;
  if (twilioClient && twilioPhoneNumber) {
    try {
      await twilioClient.messages.create({
        body: message,
        from: twilioPhoneNumber,
        to: mobileNumber
      });
      console.log(`SMS sent to ${mobileNumber}: ${message}`);
    } catch (error) {
      console.error('Twilio send SMS error:', error.message);
    }
  } else {
    console.log(`SMS simulated to ${mobileNumber}: ${message}`);
  }
}

async function sendOrderConfirmationSMS(mobileNumber, orderId, totalAmount) {
  const message = `आपला ऑर्डर ${orderId} पुष्टी करण्यात आला आहे. एकूण ₹${totalAmount}.`;
  return sendSMS(mobileNumber, message);
}

app.get('/', (req, res) => {
  const featuredCrops = db.prepare(`
    SELECT crops.*, users.name as farmer_name
    FROM crops JOIN users ON users.id = crops.user_id
    WHERE crops.status = 'active'
    ORDER BY crops.created_at DESC LIMIT 6
  `).all();

  const prices = db.prepare('SELECT * FROM market_prices ORDER BY id DESC LIMIT 6').all();
  res.render('home', { featuredCrops, prices });
});

app.get('/register', (req, res) => res.render('register'));
app.post('/register', (req, res) => {
  const { name, email, mobile, password, role, address, location } = req.body;
  if (!name || !password || !role || (!email && !mobile)) {
    setMessage(req, 'error', 'कृपया आवश्यक माहिती भरा.');
    return res.redirect('/register');
  }

  const existing = db.prepare('SELECT * FROM users WHERE email = ? OR mobile = ?').get(email || null, mobile || null);
  if (existing) {
    setMessage(req, 'error', 'हा ईमेल किंवा मोबाईल आधीच नोंदणीकृत आहे.');
    return res.redirect('/register');
  }

  const hashed = bcrypt.hashSync(password, 10);
  db.prepare(`
    INSERT INTO users (name, email, mobile, password, role, address, location)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(name, email || null, mobile || null, hashed, role, address || '', location || '');

  setMessage(req, 'success', 'नोंदणी यशस्वी झाली. आता लॉगिन करा.');
  res.redirect('/login');
});

app.get('/login', (req, res) => res.render('login'));
app.post('/login', (req, res) => {
  const { identifier, password } = req.body;
  console.log('Login attempt:', { identifier, password: password ? '[HIDDEN]' : 'empty' });

  const user = db.prepare('SELECT * FROM users WHERE id = ? OR email = ? OR mobile = ?').get(identifier, identifier, identifier);
  console.log('User lookup result:', user ? { id: user.id, email: user.email, mobile: user.mobile, role: user.role } : 'User not found');

  if (!user || !bcrypt.compareSync(password, user.password)) {
    console.log('Login failed: invalid credentials');
    setMessage(req, 'error', 'लॉगिन माहिती चुकीची आहे.');
    return res.redirect('/login');
  }

  console.log('Login successful for user:', user.name);
  req.session.user = {
    id: user.id,
    name: user.name,
    role: user.role,
    location: user.location,
    email: user.email,
    mobile: user.mobile
  };

  setMessage(req, 'success', 'लॉगिन यशस्वी झाले.');
  res.redirect('/dashboard');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  if (req.session.user.role === 'farmer') return res.redirect('/farmer');
  return res.redirect('/buyer');
});

app.get('/market-prices', (req, res) => {
  const prices = db.prepare('SELECT * FROM market_prices ORDER BY updated_at DESC').all();
  res.render('market-prices', { prices });
});

// API endpoint for market prices (for notifications)
app.get('/api/market-prices', (req, res) => {
  const prices = db.prepare('SELECT crop_name, price FROM market_prices ORDER BY crop_name').all();
  res.json(prices);
});

// API endpoint for cart count
app.get('/api/cart/count', requireAuth, (req, res) => {
  if (req.session.user.role !== 'buyer') {
    return res.json({ count: 0 });
  }
  const count = db.prepare('SELECT SUM(quantity) as count FROM cart_items WHERE user_id = ?').get(req.session.user.id);
  res.json({ count: count.count || 0 });
});

app.get('/crops', (req, res) => {
  const { q = '', category = '', location = '' } = req.query;
  const crops = db.prepare(`
    SELECT crops.*, users.name as farmer_name
    FROM crops JOIN users ON users.id = crops.user_id
    WHERE crops.status = 'active'
      AND crops.stock > 0
      AND crops.name LIKE ?
      AND crops.category LIKE ?
      AND crops.location LIKE ?
    ORDER BY crops.created_at DESC
  `).all(`%${q}%`, `%${category}%`, `%${location}%`);

  res.render('crops', { crops, filters: { q, category, location } });
});

app.get('/crop/:id', (req, res) => {
  const crop = db.prepare(`
    SELECT crops.*, users.name as farmer_name, users.mobile as farmer_mobile
    FROM crops JOIN users ON users.id = crops.user_id
    WHERE crops.id = ?
  `).get(req.params.id);

  if (!crop) return res.status(404).send('पीक सापडले नाही.');

  res.render('crop-detail', { crop });
});

app.get('/farmer', requireAuth, requireRole('farmer'), (req, res) => {
  const crops = db.prepare('SELECT * FROM crops WHERE user_id = ? ORDER BY created_at DESC').all(req.session.user.id);
  const orders = db.prepare(`
    SELECT orders.id, orders.status, orders.payment_method, orders.created_at,
           order_items.quantity, order_items.price, crops.name as crop_name
    FROM order_items
    JOIN orders ON orders.id = order_items.order_id
    JOIN crops ON crops.id = order_items.crop_id
    WHERE order_items.farmer_id = ?
    ORDER BY orders.created_at DESC
  `).all(req.session.user.id);

  const earnings = db.prepare(`
    SELECT COALESCE(SUM(order_items.quantity * order_items.price), 0) as total
    FROM order_items
    JOIN orders ON orders.id = order_items.order_id
    WHERE order_items.farmer_id = ? AND orders.status != 'cancelled'
  `).get(req.session.user.id).total;

  res.render('farmer-dashboard', { crops, orders, earnings });
});

app.get('/farmer/crops/new', requireAuth, requireRole('farmer'), (req, res) => {
  res.render('crop-form', { crop: null });
});

app.post('/farmer/crops/new', requireAuth, requireRole('farmer'), handleCropUpload, (req, res) => {
  const { name, category, quantity, unit, price, quality, location, description } = req.body;
  const imagePath = req.files && req.files.image ? `/uploads/${req.files.image[0].filename}` : null;
  const videoPath = req.files && req.files.video ? `/uploads/${req.files.video[0].filename}` : null;
  const qrCodePath = req.files && req.files.qr_code ? `/uploads/${req.files.qr_code[0].filename}` : null;

  db.prepare(`
    INSERT INTO crops (user_id, name, category, quantity, unit, price, quality, location, description, image_path, video_path, qr_code_path, stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.session.user.id,
    name,
    category,
    Number(quantity),
    unit || 'किलो',
    Number(price),
    quality || '',
    location || req.session.user.location || '',
    description || '',
    imagePath,
    videoPath,
    qrCodePath,
    Number(quantity)
  );

  setMessage(req, 'success', 'नवीन पीक यशस्वीरित्या जोडले गेले.');
  res.redirect('/farmer');
});

app.get('/farmer/crops/edit/:id', requireAuth, requireRole('farmer'), (req, res) => {
  const crop = db.prepare('SELECT * FROM crops WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!crop) {
    setMessage(req, 'error', 'पीक सापडले नाही.');
    return res.redirect('/farmer');
  }
  res.render('crop-form', { crop });
});

app.post('/farmer/crops/edit/:id', requireAuth, requireRole('farmer'), handleCropUpload, (req, res) => {
  const existing = db.prepare('SELECT * FROM crops WHERE id = ? AND user_id = ?').get(req.params.id, req.session.user.id);
  if (!existing) {
    setMessage(req, 'error', 'पीक सापडले नाही.');
    return res.redirect('/farmer');
  }

  const { name, category, quantity, unit, price, quality, location, description } = req.body;
  const imagePath = req.files && req.files.image ? `/uploads/${req.files.image[0].filename}` : existing.image_path;
  const videoPath = req.files && req.files.video ? `/uploads/${req.files.video[0].filename}` : existing.video_path;
  const qrCodePath = req.files && req.files.qr_code ? `/uploads/${req.files.qr_code[0].filename}` : existing.qr_code_path;
  const qty = Number(quantity);
  const soldQty = Number(existing.quantity) - Number(existing.stock);
  const newStock = Math.max(qty - soldQty, 0);

  db.prepare(`
    UPDATE crops
    SET name = ?, category = ?, quantity = ?, unit = ?, price = ?, quality = ?, location = ?, description = ?, image_path = ?, video_path = ?, qr_code_path = ?, stock = ?
    WHERE id = ? AND user_id = ?
  `).run(name, category, qty, unit || 'किलो', Number(price), quality || '', location || '', description || '', imagePath, videoPath, qrCodePath, newStock, req.params.id, req.session.user.id);

  setMessage(req, 'success', 'पीक माहिती अपडेट झाली.');
  res.redirect('/farmer');
});

app.post('/farmer/crops/delete/:id', requireAuth, requireRole('farmer'), (req, res) => {
  const cropId = req.params.id;

  try {
    db.prepare('DELETE FROM cart_items WHERE crop_id = ?').run(cropId);
    db.prepare('DELETE FROM order_items WHERE crop_id = ?').run(cropId);

    db.prepare('DELETE FROM crops WHERE id = ? AND user_id = ?')
      .run(cropId, req.session.user.id);

    setMessage(req, 'success', 'Crop delete झाला ✔');
    res.redirect('/farmer');

  } catch (err) {
    console.log(err);
    setMessage(req, 'error', 'Error आला ❌');
    res.redirect('/farmer');
  }
});



app.post('/farmer/order/:id/status', requireAuth, requireRole('farmer'), (req, res) => {
  const { status } = req.body;
  // Check if the farmer has items in this order
  const hasOrder = db.prepare(`
    SELECT COUNT(*) as count FROM order_items
    WHERE order_id = ? AND farmer_id = ?
  `).get(req.params.id, req.session.user.id).count;

  if (hasOrder > 0) {
    db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
    setMessage(req, 'success', 'ऑर्डर स्थिती अपडेट झाली.');
  } else {
    setMessage(req, 'error', 'या ऑर्डरमध्ये प्रवेश नाही.');
  }
  res.redirect('/farmer');
});

app.get('/buyer', requireAuth, requireRole('buyer'), (req, res) => {
  const cartCount = db.prepare('SELECT COUNT(*) as count FROM cart_items WHERE user_id = ?').get(req.session.user.id).count;

  // Get order items with existing reviews, if any
  const orderItems = db.prepare(`
    SELECT
      order_items.*,
      orders.status,
      orders.created_at,
      crops.name as crop_name,
      crops.unit,
      users.name as farmer_name,
      reviews.id as review_id,
      reviews.rating as review_rating,
      reviews.comment as review_comment
    FROM order_items
    JOIN orders ON orders.id = order_items.order_id
    JOIN crops ON crops.id = order_items.crop_id
    JOIN users ON users.id = order_items.farmer_id
    LEFT JOIN reviews ON reviews.order_id = order_items.order_id AND reviews.crop_id = order_items.crop_id AND reviews.user_id = ?
    WHERE orders.user_id = ?
    ORDER BY orders.created_at DESC, order_items.id ASC
  `).all(req.session.user.id, req.session.user.id);

  res.render('buyer-dashboard', { cartCount, orderItems });
});

app.get('/buyer/invoice/:id', requireAuth, requireRole('buyer'), (req, res) => {
  const invoice = getBuyerInvoice(req.params.id, req.session.user.id);
  if (!invoice) {
    setMessage(req, 'error', 'इनव्हॉईस सापडली नाही.');
    return res.redirect('/buyer');
  }

  res.render('buyer-invoice', invoice);
});

app.post('/cart/add/:id', requireAuth, requireRole('buyer'), (req, res) => {
  const crop = db.prepare('SELECT * FROM crops WHERE id = ? AND stock > 0').get(req.params.id);
  if (!crop) {
    setMessage(req, 'error', 'हे पीक उपलब्ध नाही.');
    return res.redirect('/crops');
  }

  const existing = db.prepare('SELECT * FROM cart_items WHERE user_id = ? AND crop_id = ?').get(req.session.user.id, req.params.id);
  if (existing) {
    const qty = Math.min(Number(existing.quantity) + 1, Number(crop.stock));
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(qty, existing.id);
  } else {
    db.prepare('INSERT INTO cart_items (user_id, crop_id, quantity) VALUES (?, ?, ?)').run(req.session.user.id, req.params.id, 1);
  }

  setMessage(req, 'success', 'पीक कार्टमध्ये जोडले गेले.');
  res.redirect('/cart');
});

app.get('/cart', requireAuth, requireRole('buyer'), (req, res) => {
  const items = db.prepare(`
    SELECT cart_items.id, cart_items.quantity as cart_qty, crops.*, users.name as farmer_name
    FROM cart_items
    JOIN crops ON crops.id = cart_items.crop_id
    JOIN users ON users.id = crops.user_id
    WHERE cart_items.user_id = ?
    ORDER BY cart_items.id DESC
  `).all(req.session.user.id);

  const total = items.reduce((sum, item) => sum + Number(item.cart_qty) * Number(item.price), 0);
  res.render('cart', { items, total });
});

app.post('/cart/update/:id', requireAuth, requireRole('buyer'), (req, res) => {
  const qty = Math.max(Number(req.body.quantity), 1);
  const item = db.prepare(`
    SELECT cart_items.*, crops.stock FROM cart_items
    JOIN crops ON crops.id = cart_items.crop_id
    WHERE cart_items.id = ? AND cart_items.user_id = ?
  `).get(req.params.id, req.session.user.id);

  if (item) {
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(Math.min(qty, Number(item.stock)), req.params.id);
  }

  setMessage(req, 'success', 'कार्ट अपडेट झाली.');
  res.redirect('/cart');
});

app.post('/cart/remove/:id', requireAuth, requireRole('buyer'), (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE id = ? AND user_id = ?').run(req.params.id, req.session.user.id);
  setMessage(req, 'success', 'आयटम कार्टमधून हटवले गेले.');
  res.redirect('/cart');
});

app.post('/buyer/order/:id/review', requireAuth, requireRole('buyer'), (req, res) => {
  const orderId = req.params.id;
  const { crop_id, rating, comment } = req.body;

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.session.user.id);
  if (!order) {
    setMessage(req, 'error', 'ऑर्डर आढळली नाही.');
    return res.redirect('/buyer');
  }

  if (order.status !== 'delivered') {
    setMessage(req, 'error', 'केवळ वितरित झालेल्या ऑर्डरनाच रिव्ह्यू देता येतो.');
    return res.redirect('/buyer');
  }

  const crop = db.prepare('SELECT * FROM crops WHERE id = ?').get(crop_id);
  if (!crop) {
    setMessage(req, 'error', 'पीक आढळले नाही.');
    return res.redirect('/buyer');
  }

  const existingReview = db.prepare('SELECT * FROM reviews WHERE order_id = ? AND crop_id = ? AND user_id = ?').get(orderId, crop_id, req.session.user.id);
  if (existingReview) {
    setMessage(req, 'error', 'तुम्ही आधीच या ऑर्डरसाठी रिव्ह्यू दिला आहे.');
    return res.redirect('/buyer');
  }

  db.prepare(`
    INSERT INTO reviews (order_id, crop_id, user_id, farmer_id, rating, comment)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(orderId, crop_id, req.session.user.id, crop.user_id, Number(rating), comment || '');

  setMessage(req, 'success', 'Review जतन केला गेला.');
  res.redirect('/buyer');
});

app.post('/payment-confirmation', requireAuth, requireRole('buyer'), (req, res) => {
  const { payment_method, delivery_type, delivery_address } = req.body;
  
  const items = db.prepare(`
    SELECT cart_items.*, crops.price, crops.stock, crops.user_id as farmer_id, crops.name as crop_name, crops.qr_code_path,
           users.name as farmer_name
    FROM cart_items
    JOIN crops ON crops.id = cart_items.crop_id
    JOIN users ON users.id = crops.user_id
    WHERE cart_items.user_id = ?
  `).all(req.session.user.id);

  if (!items.length) {
    setMessage(req, 'error', 'तुमची कार्ट रिकामी आहे.');
    return res.redirect('/cart');
  }

  for (const item of items) {
    if (Number(item.quantity) > Number(item.stock)) {
      setMessage(req, 'error', `स्टॉक अपुरा आहे: ${item.crop_name}`);
      return res.redirect('/cart');
    }
  }

  const total = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price), 0);

  // Get QR codes for UPI payment
  let qrCodes = [];
  if (payment_method === 'UPI') {
    const farmerGroups = {};
    items.forEach(item => {
      if (!farmerGroups[item.farmer_id]) {
        farmerGroups[item.farmer_id] = {
          farmer_name: item.farmer_name,
          qr_code_path: item.qr_code_path,
          amount: 0
        };
      }
      farmerGroups[item.farmer_id].amount += Number(item.quantity) * Number(item.price);
    });
    qrCodes = Object.values(farmerGroups).filter(f => f.qr_code_path);
  }

  res.render('payment-confirmation', {
    items,
    total,
    paymentMethod: payment_method,
    deliveryType: delivery_type,
    deliveryAddress: delivery_address,
    qrCodes
  });
});

app.post('/checkout', requireAuth, requireRole('buyer'), async (req, res) => {
  const { payment_method, delivery_type, delivery_address } = req.body;
  const items = db.prepare(`
    SELECT cart_items.*, crops.price, crops.stock, crops.user_id as farmer_id, crops.name as crop_name
    FROM cart_items
    JOIN crops ON crops.id = cart_items.crop_id
    WHERE cart_items.user_id = ?
  `).all(req.session.user.id);

  if (!items.length) {
    setMessage(req, 'error', 'तुमची कार्ट रिकामी आहे.');
    return res.redirect('/cart');
  }

  for (const item of items) {
    if (Number(item.quantity) > Number(item.stock)) {
      setMessage(req, 'error', `स्टॉक अपुरा आहे: ${item.crop_name}`);
      return res.redirect('/cart');
    }
  }

  const total = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.price), 0);

  const orderId = db.transaction(() => {
    const orderInfo = db.prepare(`
      INSERT INTO orders (user_id, total, status, payment_method, delivery_type, delivery_address)
      VALUES (?, ?, 'confirmed', ?, ?, ?)
    `).run(req.session.user.id, total, payment_method, delivery_type, delivery_address || '');

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, crop_id, farmer_id, quantity, price)
      VALUES (?, ?, ?, ?, ?)
    `);
    const updateCrop = db.prepare('UPDATE crops SET stock = stock - ? WHERE id = ?');
    const clearCart = db.prepare('DELETE FROM cart_items WHERE user_id = ?');

    items.forEach(item => {
      insertItem.run(orderInfo.lastInsertRowid, item.crop_id, item.farmer_id, item.quantity, item.price);
      updateCrop.run(item.quantity, item.crop_id);
    });

    clearCart.run(req.session.user.id);
    return orderInfo.lastInsertRowid;
  })();

  const buyer = db.prepare('SELECT mobile FROM users WHERE id = ?').get(req.session.user.id);
  if (buyer && buyer.mobile) {
    await sendOrderConfirmationSMS(buyer.mobile, orderId, total);
  }

  setMessage(req, 'success', 'ऑर्डर यशस्वीपणे पूर्ण झाली. इनव्हॉईस आता ग्राहक डॅशबोर्डमध्ये उपलब्ध आहे.');
  res.redirect(`/buyer/invoice/${orderId}`);
});

// Function to update market prices automatically
function updateMarketPrices() {
  const crops = ['कांदा', 'टोमॅटो', 'गहू', 'बटाटा', 'मका', 'द्राक्षे', 'केळी', 'आंबा', 'संत्रा', 'कापूस'];
  const locations = ['पुणे', 'नाशिक', 'अहमदनगर', 'सोलापूर', 'जळगाव', 'सांगली', 'कोल्हापूर', 'मुंबई'];

  crops.forEach(crop => {
    // Simulate price fluctuation: ±10% change
    const currentPrice = db.prepare('SELECT price FROM market_prices WHERE crop_name = ? ORDER BY updated_at DESC LIMIT 1').get(crop);
    if (currentPrice) {
      const change = (Math.random() - 0.5) * 0.2; // -10% to +10%
      const newPrice = Math.max(1, Math.round(currentPrice.price * (1 + change)));
      const location = locations[Math.floor(Math.random() * locations.length)];

      db.prepare('UPDATE market_prices SET price = ?, market_location = ?, updated_at = CURRENT_TIMESTAMP WHERE crop_name = ?').run(newPrice, location, crop);
    }
  });

  console.log('Market prices updated at', new Date().toISOString());
}

// Update prices every 5 minutes (300000 ms)
setInterval(updateMarketPrices, 300000);

// Initial update on server start
updateMarketPrices();

app.listen(PORT, () => {
  console.log(`Shetmaal Bazaar running on http://localhost:${PORT}`);
});
