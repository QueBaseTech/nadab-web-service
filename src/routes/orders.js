const router = require('express').Router();
const { Order,
    OrderPaymentsSchema,
    OrderItemSchema,
    validateOrderPaymentObject,
    validateOrderItemObject } = require('../models/Order');
const Hotel = require('../models/Hotel');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const _ = require('lodash');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const {google} = require('googleapis');

var MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
var SCOPES = [MESSAGING_SCOPE];

function getAccessToken() {
  return new Promise(function(resolve, reject) {
    var key = require('../../service-account.json');
    var jwtClient = new google.auth.JWT(
      key.client_email,
      null,
      key.private_key,
      SCOPES,
      null
    );
    jwtClient.authorize(function(err, tokens) {
      if (err) {
        reject(err);
        return;
      }
      resolve(tokens.access_token);
    });
  });
}


// Orders list for a hotel
router.get('/hotel/orders', (req, res) => {
  let hotel = {}

  if (req.headers['x-token'] || req.query['token']) {
    let token = "";
    if (req.headers['x-token'] !== undefined) token = req.headers['x-token'];
    if (req.query['token'] !== undefined) token = req.query['token'];
    jwt.verify(token, process.env.SESSIONKEY, function(error, decode) {
      if (error) {
        throw new Error(error.message);
      } else {
        hotel = decode;
      }
    });
  }

  let params = hotel.id ? { hotel: mongoose.Types.ObjectId(hotel.id) } : {};
  Order
    .find(params)
    // .populate('users', 'servedBy')
    // .populate('hotel', 'businessName')
    .then((orders) => {
      res.json({ success: true, orders });
    }).catch((e) => {
    res.status(400).json({ success: false, message: e.message });
  });
});

// Orders list for a user
router.get('/user/orders', (req, res) => {
  let hotel = {}

  if (req.headers['x-token'] || req.query['token']) {
    let token = "";
    if (req.headers['x-token'] !== undefined) token = req.headers['x-token'];
    if (req.query['token'] !== undefined) token = req.query['token'];
    jwt.verify(token, process.env.SESSIONKEY, function(error, decode) {
      if (error) {
        throw new Error(error.message);
      } else {
        hotel = decode;
      }
    });
  }

  let params = hotel.id ? { hotel: mongoose.Types.ObjectId(hotel.id) } : {};
  Order
    .find(params)
    .then((orders) => {
      res.json({ success: true, orders });
    }).catch((e) => {
    res.status(400).json({ success: false, message: e.message });
  });
});

// Get specific order
router.get('/orders/:id', (req, res) => {
  Order.findById(req.params.id).then((order) => {
    res.json({ success: true, order });
  }).catch((e) => {
    res.status(400).json({ success: false, message: e.message });
  });
});

// Add a new order
router.post('/orders/add', (req, res) => {
  if (Object.keys(req.body).length === 0) {
    res.status(400).json({ success: false, message: 'A request body is required' });
  } else {
    const payments = req.body.payments;
    const items = req.body.items;
    delete req.body.items;
    delete req.body.payments;
    let order = new Order(req.body);
    let itemsMessage = '';

    _.each(items, (item) => {
      itemsMessage += `${item.qty} ${item.name} @ ${parseInt(item.price)*parseInt(item.qty)} \n`;
      let orderItem = new OrderItemSchema({
        name: item.name,
        qty: item.qty,
        price: item.price
      });
      let { error } = validateOrderItemObject(orderItem);
      if (!!error){
        order.items.push(orderItem);
      } else {
        res.json({ success: false, message: error.message });
      }
    });
    _.each(payments, (payment) => {
      let orderPayment = new OrderPaymentsSchema({
        method: payment.method,
        amount: payment.amount,
        transactionCode: payment.hasOwnProperty('transactionCode') ? payment.transactionCode: ""
      });
      let { error } = validateOrderPaymentObject(orderPayment);
      if (!!error){
        order.payments.push(orderPayment);
      } else {
        res.json({ success: false, message: error.message });
      }
    });

    order.save().then((order) => {
      Hotel.findById(order.hotel).then(hotel => {
        getAccessToken().then(accessToken => {
          axios.post( `https://fcm.googleapis.com/v1/projects/nadab-9a76a/messages:send`, 
            {
              "message":{
                "token" : hotel.FCMToken,
                "notification" : {
                  "body" : itemsMessage,
                  "title" : "You have a new order"
                  }
               }
            },
            {
             headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${accessToken}`
            }
          }).then( response => {
            console.log("Notification sent...");
          }).catch(error => {
            console.log(error.message);
          });
        }).catch(error => {
          console.log(error);
        });
      }).catch(error => {
        console.log(error);
      });
      res.json({ success: true, order });
    }).catch((e) => {
      res.json({ success: false, message: e.message });
    });
  }
});

// Mark order as complete
router.put('/orders/:id/:status', (req, res) => {
  Order.findByIdAndUpdate(req.params.id, { status: req.params.status }, { new: true }).then((order) => {
    res.json({ success: true, order });
  }).catch((e) => {
    res.status(400).json({ success: false, message: e.message });
  });
});


// Edit order
router.put('/orders/:id/edit', (req, res) => {
  if (Object.keys(req.body).length === 0) {
    return res.status(404).json({ success: false, message: 'A request body is required' });
  }
  Order.findByIdAndUpdate(req.params.id, req.body, { new: true }).then((order) => {
    res.json({ success: true, order });
  }).catch((e) => {
    res.status(404).json({ success: false, message: e.message });
  });
});

// Delete order
router.delete('/orders/:id/delete', (req, res) => {
  Order.findByIdAndDelete(req.params.id).then((order) => {
    res.json({ success: true, order });
  }).catch((e) => {
    res.status(404).json({ success: false, message: e.message });
  });
});

module.exports = (app) => {
  app.use('/', router);
}
