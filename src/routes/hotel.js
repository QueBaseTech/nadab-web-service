const router = require('express')
  .Router();
const Hotel = require('../models/Hotel');
const Product = require('../models/Product');
const User = require('../models/User');
const Fees = require('../models/Fee');
const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const im = require('imagemagick');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const storage = multer.diskStorage({
  destination: 'public/images/uploads/hotels',
  filename: function (req, file, cb) {
    crypto.pseudoRandomBytes(16, function (err, raw) {
      if (err) return cb(err);

      cb(null, raw.toString('hex') + path.extname(file.originalname));
    });
  }
});
const upload = multer({ storage: storage });

router.get('/hotels', (req, res) => {
  Hotel.find()
    .then((h) => {
      res.json({
        success: true,
        hotels: h
      });
    })
    .catch((e) => {
      res.status(404)
        .json({
          success: false,
          message: e.message
        });
    });
});

// Products list
router.get('/hotels/:id/products', (req, res) => {
  Product
    .find({
      $and: [
        { hotel: mongoose.Types.ObjectId(req.params.id) },
        { sellingStatus: true }
      ]
    })
    .then((products) => {
      res.json({
        success: true,
        products
      });
    })
    .catch((e) => {
      res.status(404)
        .json({
          success: false,
          message: e.message
        });
    });
});

router.get('/search', (req, res) => {
  let queryString = req.query;
  let name = queryString.name;
  // let hotel = queryString.hotel;
  name = name.toLowerCase();
  Hotel.find({ businessName: name })
    .then((h) => {
      res.json({
        success: true,
        hotels: h
      });
    })
    .catch((e) => {
      res.status(404)
        .json({
          success: false,
          message: e.message
        });
    });
});

router.post('/register', upload.single('image'), (req, res) => {
  if (req.body === undefined) {
    throw new Error('A request body is required');
  }
  let hotel = new Hotel(req.body);
  hotel.mobileNumber = parseInt(hotel.mobileNumber);
  hotel.image = `${req.file.filename}`;
  bcrypt.hash(hotel.password, 10)
    .then((hash) => {
      hotel.password = hash;
      return hotel.save();
    })
    .then((hotel) => {
      // TODO:: Send verification email ~ via a message broker
      im.resize({
        srcPath: `public/images/uploads/hotels/${req.file.filename}`,
        dstPath: `public/images/uploads/hotels/thumb_${req.file.filename}`,
        width: 300,
        height: 300
      }, function (error, stdin, stdout) {
        if (error) {
          console.log(error);
        } else {
          console.log('Image resized successfully');
        }
      });
      let token = jwt.sign({
        email: hotel.email,
        id: hotel._id
      }, process.env.SESSIONKEY);
      res.json({
        success: true,
        hotel,
        token
      });
    })
    .catch((e) => {
      console.log(e);
      res.status(404)
        .json({
          success: false,
          message: e.message
        });
    });
});

router.post('/login', (req, res) => {
  try {
    if (req.body.email === undefined || req.body.password === undefined) {
      throw new Error('Email and password are required');
    }
  } catch (e) {
    return res.status(404)
      .json({
        success: false,
        message: e.message
      });
  }
  let hotel;
  Hotel.findOne({ businessEmail: req.body.email })
    .then((h) => {
      hotel = h;
      if (hotel) {
        return bcrypt.compare(req.body.password, hotel.password);
      } else {
        return User.findOne({ email: req.body.email });
      }
    })
    .then((status) => {
      if (typeof status === 'boolean') {
        if (status) {
          let token = jwt.sign({
            email: hotel.businessEmail,
            id: hotel._id
          }, process.env.SESSIONKEY);
          console.log(hotel);
          return res.json({
            success: true,
            token,
            hotel
          });
        } else {
          throw new Error('Invalid email/password');
        }
      } else {
        let user = status;
        if (user === null) {
          throw new Error('User doesn\'t exist');
        } else {
          return bcrypt.compare(req.body.password, user.password)
            .then((isMatch) => {
              if (isMatch) {
                let token = jwt.sign({
                  email: user.email,
                  id: user._id
                }, process.env.SESSIONKEY);
                res.json({
                  success: true,
                  token,
                  hotel
                });
              } else {
                throw new Error('Invalid email/password');
              }
            });
        }
      }
    })
    .catch((e) => {
      res.status(404)
        .json({
          success: false,
          message: e.message
        });
    });
});

router.put('/hotels/edit/:id', (req, res) => {
  if (Object.keys(req.body).length === 0) {
    return res.json({
      success: false,
      message: 'A request body is required'
    });
  }
  Hotel.findById(mongoose.Types.ObjectId(req.params.id))
    .then((hotel) => {
      if (req.body.applicantName) hotel.applicantName = req.body.applicantName;
      if (req.body.businessEmail) hotel.businessEmail = req.body.businessEmail;
      if (req.body.mobileNumber) hotel.mobileNumber = req.body.mobileNumber;
      if (req.body.businessName) hotel.businessName = req.body.businessName;
      if (req.body.city) hotel.city = req.body.city;
      if (req.body.address) hotel.address = req.body.address;
      if (req.body.payBillNo) hotel.payBillNo = req.body.payBillNo;
      hotel.save()
        .then(hotel => {
          res.json({
            success: true,
            hotel
          });
        })
        .catch((e) => {
          res.status(400)
            .json({
              success: false,
              message: e.message
            });
        });
    })
    .catch((e) => {
      res.status(404)
        .json({
          success: false,
          message: e.message
        });
    });
});

router.put('/hotels/edit/:id/image', upload.single('image'), (req, res) => {
  if (Object.keys(req.body).length === 0) {
    return res.json({
      success: false,
      message: 'A request body is required'
    });
  }

  Hotel.findById(mongoose.Types.ObjectId(req.params.id))
    .then((hotel) => {
      if (req.body.applicantName) hotel.applicantName = req.body.applicantName;
      if (req.body.businessEmail) hotel.businessEmail = parseInt(req.body.businessEmail);
      if (req.body.mobileNumber) hotel.mobileNumber = req.body.mobileNumber;
      if (req.body.businessName) hotel.businessName = req.body.businessName;
      if (req.body.city) hotel.city = req.body.city;
      if (req.body.address) hotel.address = req.body.address;
      if (req.body.payBillNo) hotel.payBillNo = req.body.payBillNo;
      hotel.image = req.file.filename;
      hotel.save()
        .then(hotel => {
          im.resize({
            srcPath: `public/images/uploads/hotels/${req.file.filename}`,
            dstPath: `public/images/uploads/hotels/thumb_${req.file.filename}`,
            width: 300,
            height: 300
          }, function (error, stdin, stdout) {
            if (error) {
              console.log(error);
            } else {
              console.log('Image resized successfully');
            }
          });
          res.json({
            success: true,
            hotel
          });
        })
        .catch((e) => {
          res.status(400)
            .json({
              success: false,
              message: e.message
            });
        });
    })
    .catch((e) => {
      res.status(404)
        .json({
          success: false,
          message: e.message
        });
    });
});


router.get('/hotel/fees', (req, res) => {
  // Pull hotel token and use it to filter hotels
  let hotel = {};

  if (req.headers['x-token'] || req.query['token']) {
    let token = '';
    if (req.headers['x-token'] !== undefined) token = req.headers['x-token'];
    if (req.query['token'] !== undefined) token = req.query['token'];
    jwt.verify(token, process.env.SESSIONKEY, function (error, decode) {
      if (error) {
        throw new Error(error.message);
      } else {
        hotel = decode;
      }
    });
  }

  let params = hotel.id ? { hotel: mongoose.Types.ObjectId(hotel.id) } : {};
  Fees
    .find(params)
    // .populate('hotel', 'businessName')
    .sort({ createdAt: 'desc' })
    .then((fees) => {
      res.json({
        success: true,
        fees
      });
    })
    .catch((e) => {
      res.status(404)
        .json({
          success: false,
          message: e.message
        });
    });
});

module.exports = (app) => {
  app.use('/', router);
};
