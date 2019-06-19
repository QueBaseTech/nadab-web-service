const router = require('express')
  .Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const _ = require('lodash');
const axios = require('axios');
const moment = require('moment');
const { google } = require('googleapis');

const {
  Order,
  OrderPaymentsSchema,
  OrderItemSchema,
  validateOrderPaymentObject,
  validateOrderItemObject
} = require('../models/Order');
const Hotel = require('../models/Hotel');
const Customer = require('../models/Customer');
const Fee = require('../models/Fee');

var MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
var SCOPES = [MESSAGING_SCOPE];
var projectID;

function getAccessToken() {
  return new Promise(function (resolve, reject) {
    var key = require('../../service-account.json');
    projectID = key.project_id;
    var jwtClient = new google.auth.JWT(
      key.client_email,
      null,
      key.private_key,
      SCOPES,
      null
    );
    jwtClient.authorize(function (err, tokens) {
      if (err) {
        reject(err);
        return;
      }
      resolve(tokens.access_token);
    });
  });
}

function getNotificationMessage(orderStatus) {
  let message = 'Your order was updated';
  let update = 'update';

  if (orderStatus == 'BILLS') {
    message = 'Your order has been accepted and will be delivered soon';
    update = 'accepted';
  }

  if (orderStatus == 'NEW') {
    message = 'You have a new order';
    update = '';
  }

  if (orderStatus == 'PAID') {
    message = 'Your bill has been paid';
    update = 'paid';
  }

  if (orderStatus == 'SALES') {
    message = 'Your bill is ready';
    update = 'billed';
  }


  if (orderStatus == 'REJECTED') {
    message = 'Your order was rejected';
    update = 'rejected';
  }

  if (orderStatus == 'RE-ORDER') {
    message = 'Item added to order';
    update = 're-ordered';
  }

  if (orderStatus == 'COMPLETE') {
    message = 'Your order is complete. Thank you for using Nadab Hotel Services';
    update = 'complete';
  }


  return {
    message,
    update
  };
}

function sendNotification(authToken, deviceToken, title, body, order) {
  axios.post(`https://fcm.googleapis.com/v1/projects/${projectID}/messages:send`,
    {
      'message': {
        'token': deviceToken,
        'data': {
          'orderID': order._id,
          'status': order.status,
          'body': body,
          'title': `Order ${title}`
        }
      }
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }
    })
    .then(response => {
      console.log('Notification sent...');
    })
    .catch(error => {
      console.log(error.message);
    });
}

// Orders list for a hotel
router.get('/hotel/orders', (req, res) => {
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

  let params = hotel.id ? { hotelId: mongoose.Types.ObjectId(hotel.id) } : {};
  Order
    .find(params)
    .sort({ 'createdAt': 'desc' })
    .populate('customerId', 'fullName')
    // .populate('hotel', 'businessName')
    .then((orders) => {
      res.json({
        success: true,
        orders
      });
    })
    .catch((e) => {
      res.json({
        success: false,
        message: e.message
      });
    });
});

// Orders list for a user
router.get('/user/orders', (req, res) => {
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

  let params = hotel.id ? { hotelId: mongoose.Types.ObjectId(hotel.id) } : {};
  Order
    .find(params)
    .then((orders) => {
      res.json({
        success: true,
        orders
      });
    })
    .catch((e) => {
      res.json({
        success: false,
        message: e.message
      });
    });
});

// Get specific order
router.get('/orders/:id', (req, res) => {
  Order
    .findById(req.params.id)
    .populate('customerId', 'fullName')
    .then((order) => {
      res.json({
        success: true,
        order
      });
    })
    .catch((e) => {
      res.json({
        success: false,
        message: e.message
      });
    });
});

// Orders list for a customer <customer app>
router.get('/customer/orders', (req, res) => {
  let customer = {};

  if (req.headers['x-token'] || req.query['token']) {
    let token = '';
    if (req.headers['x-token'] !== undefined) token = req.headers['x-token'];
    if (req.query['token'] !== undefined) token = req.query['token'];
    jwt.verify(token, process.env.SESSIONKEY, function (error, decode) {
      if (error) {
        throw new Error(error.message);
      } else {
        customer = decode;
      }
    });
  }

  let params = customer.id ? { customerId: mongoose.Types.ObjectId(customer.id) } : {};
  Order
    .find(params)
    .sort({ 'createdAt': 'asc' })
    .populate('hotelId', 'businessName')
    .then((orders) => {
      orders.forEach(order => {
        order.hotel = order.hotelId;
        order.hotelId = order.hotelId._id;
      });
      res.json({
        success: true,
        orders
      });
    })
    .catch((e) => {
      console.log(e);
      res.json({
        success: false,
        message: e.message
      });
    });
});

// Add a new order
router.post('/orders/add', (req, res) => {
  if (Object.keys(req.body).length === 0) {
    res.json({
      success: false,
      message: 'A request body is required'
    });
  } else {
    const payments = req.body.payments;
    const items = req.body.items;
    delete req.body.items;
    delete req.body.payments;
    let order = new Order(req.body);
    order.hotelId = req.body.hotelId;
    let itemsMessage = '';

    _.each(items, (item) => {
      itemsMessage += `${item.qty} ${item.name} @ ${item.price} \n`;
      let orderItem = new OrderItemSchema({
        name: item.name,
        qty: item.qty,
        price: item.price
      });
      let { error } = validateOrderItemObject(orderItem);
      if (!!error) {
        order.items.push(orderItem);
      } else {
        res.json({
          success: false,
          message: error.message
        });
      }
    });
    _.each(payments, (payment) => {
      let orderPayment = new OrderPaymentsSchema({
        method: payment.method,
        amount: payment.amount,
        transactionCode: payment.hasOwnProperty('transactionCode') ? payment.transactionCode : ''
      });
      let { error } = validateOrderPaymentObject(orderPayment);
      if (!!error) {
        order.payments.push(orderPayment);
      } else {
        res.json({
          success: false,
          message: error.message
        });
      }
    });

    let { message, update } = getNotificationMessage(order.status);
    order.save()
      .then((o) => {
        Hotel.findById(req.body.hotelId)
          .then(hotel => {
            order = o;
            order.hotel = hotel;
            getAccessToken()
              .then(accessToken => {
                sendNotification(accessToken, hotel.FCMToken, message, itemsMessage, order);
              })
              .catch(error => {
                console.log(error.message);
              });
          })
          .catch(error => {
            console.log(error.message);
            return res.json({
              success: false,
              message: error.message
            });
          });
        res.json({
          success: true,
          order
        });
      })
      .catch((e) => {
        res.json({
          success: false,
          message: e.message
        });
      });
  }
});

router.post('/orders/:id/addItem', async (req, res) => {
  if (Object.keys(req.body).length === 0) {
    res.json({
      success: false,
      message: 'A request body is required'
    });
  } else {
    const items = [req.body];
    let itemsMessage = '';
    let order = {};
    try {
      order = await Order.findById(req.params.id);
    } catch (e) {
      return res.json({
        success: false,
        message: e.message
      });
    }
    // TODO :: PLEASE FIND A WAY TO OPTIMIZE THIS CODE BELOW, TOO MUCH COMPLEXITY AT THE MOMENT, WILL HAVE TO ADD A CONTROLLER WHICH CAN HANDLE SIMPLY ADDING NEW ORDERS ~ By Joe
    // If order is complete insert a new order
    if (order.status == 'COMPLETE') {
      let order = new Order();
      order.hotelId = req.body.hotelId;
      order.customerId = req.body.customerId;
      order.status = 'NEW';
      order.items = [];
      let itemsMessage = '';

      _.each(items, (item) => {
        itemsMessage += `${item.qty} ${item.name} @ ${item.price} \n`;
        let orderItem = new OrderItemSchema({
          name: item.name,
          qty: item.qty,
          price: item.price
        });
        order.totalItems = item.qty;
        order.totalPrice = item.price;
        let { error } = validateOrderItemObject(orderItem);
        if (!!error) {
          order.items.push(orderItem);
        } else {
          return res.json({
            success: false,
            message: error.message
          });
        }
      });

      let { message, update } = getNotificationMessage(order.status);
      order.save()
        .then((o) => {
          Hotel.findById(req.body.hotelId)
            .then(hotel => {
              order = o;
              order.hotel = hotel;
              getAccessToken()
                .then(accessToken => {
                  sendNotification(accessToken, hotel.FCMToken, message, itemsMessage, order);
                })
                .catch(error => {
                  console.log(error.message);
                });
            })
            .catch(error => {
              console.log(error.message);
              return res.json({
                success: false,
                message: error.message
              });
            });
          return res.json({
            success: true,
            order
          });
        })
        .catch((e) => {
          return res.json({
            success: false,
            message: e.message
          });
        });
    } else {
      // Update the current order
      _.each(items, (item) => {
        itemsMessage += `${item.qty} ${item.name} @ ${item.price} \n`;
        let orderItem = new OrderItemSchema({
          name: item.name,
          qty: item.qty,
          price: item.price
        });
        let { error } = validateOrderItemObject(orderItem);
        if (!!error) {
          order.totalItems += 1;
          order.totalPrice += orderItem.price;
          order.status = 'RE-ORDER';
          order.items.push(orderItem);
        } else {
          res.json({
            success: false,
            message: error.message
          });
        }
      });

      let { message, update } = getNotificationMessage(order.status);
      order.save()
        .then((order) => {
          Hotel.findById(order.hotelId)
            .then(hotel => {
              getAccessToken()
                .then(accessToken => {
                  sendNotification(accessToken, hotel.FCMToken, message, itemsMessage, order);
                })
                .catch(error => {
                  console.log(error.message);
                });
            })
            .catch(error => {
              console.log(error.message);
            });
          res.json({
            success: true,
            order
          });
        })
        .catch((e) => {
          res.json({
            success: false,
            message: e.message
          });
        });
    }
  }
});

router.put('/orders/:id/:status', (req, res) => {
  Order
    .findByIdAndUpdate(req.params.id, { status: req.params.status }, { new: true })
    .populate('customerId', 'fullName')
    .then(async (order) => {
      let customer = await Customer.findById(order.customerId);
      let { message, update } = getNotificationMessage(order.status);
      getAccessToken()
        .then(accessToken => {
          (order.status !== 'HIDDEN') ? sendNotification(accessToken, customer.FCMToken, update, message, order) : '';
        })
        .catch(error => {
          console.log(error.message);
        });

      // If order is complete, insert a Nadab fee
      if (order.status == 'COMPLETE') {
        // Check if there's an entry for hotel and day
        const date = new Date();
        const day = `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}`;
        let fee = await Fee.findOne({
          hotel: order.hotelId,
          day: day
        });
        if (fee) {
          // Update the fee
          fee.total = parseFloat(fee.total) + parseFloat(((order.totalBill) * 0.0099).toFixed(2));
          fee.ordersId.push(order._id);
          fee.numberOfOrders += 1;
        } else {
          // Create a new record
          fee = new Fee();
          fee.total = (order.totalBill * 0.0099).toFixed(2);
          fee.numberOfOrders = 1;
          fee.ordersId = [order._id];
          fee.day = day;
          fee.hotel = order.hotelId;
        }
        await fee.save();
      }
      res.json({
        success: true,
        order
      });
    })
    .catch((e) => {
      console.log(e);
      res.json({
        success: false,
        message: e.message
      });
    });
});

router.put('/orders/:orderId/all/:status', (req, res) => {
  Order
    .findById(req.params.orderId)
    .populate('customerId', 'fullName')
    .then(async (order) => {
      let customer = await Customer.findById(order.customerId);
      order.items.forEach((item) => {
        if (req.params.status == 'ACCEPTED' || req.params.status == 'REJECTED') item.status = req.params.status;
        if (req.params.status == 'ACCEPTED') order.totalBill += item.price;
      });
      // Move the order to bills if all have been accepted
      if (req.params.status == 'ACCEPTED') order.status = 'BILLS';
      if (req.params.status == 'REJECTED') order.status = 'REJECTED';
      if (req.params.status == 'PAID') order.status = 'SALES';
      if (req.params.status == 'COMPLETE') order.status = 'COMPLETE';
      if (req.params.status == 'CANCEL') order.status = 'CANCELED';

      let { message, update } = getNotificationMessage(order.status);
      getAccessToken()
        .then(accessToken => {
          sendNotification(accessToken, customer.FCMToken, update, message, order);
        })
        .catch(error => {
          console.log(error.message);
        });
      order = await order.save({ new: true });
      res.json({
        success: true,
        order
      });
    })
    .catch((e) => {
      console.log(e);
      res.json({
        success: false,
        message: e.message
      });
    });
});

router.put('/orders/:orderId/:itemId/:status', (req, res) => {
  Order
    .findById(req.params.orderId)
    .populate('customerId', 'fullName')
    .then(async (order) => {
      let customer = await Customer.findById(order.customerId);
      if (order.status == 'NEW' || req.params.status == 'ACCEPTED') order.status = 'BILLS';
      let { message, update } = getNotificationMessage(order.status);
      order.items.filter((item) => {
        if (item._id == req.params.itemId) {
          item.status = req.params.status;
          if (req.params.status == 'ACCEPTED') order.totalBill += item.price;
        }
      });
      getAccessToken()
        .then(accessToken => {
          sendNotification(accessToken, customer.FCMToken, update, message, order);
        })
        .catch(error => {
          console.log(error.message);
        });
      order = await order.save({ new: true });
      res.json({
        success: true,
        order
      });
    })
    .catch((e) => {
      console.log(e);
      res.json({
        success: false,
        message: e.message
      });
    });
});

// Edit order
router.put('/orders/:id/edit', (req, res) => {
  if (Object.keys(req.body).length === 0) {
    return res.status(404)
      .json({
        success: false,
        message: 'A request body is required'
      });
  }
  Order.findByIdAndUpdate(req.params.id, req.body, { new: true })
    .then((order) => {
      res.json({
        success: true,
        order
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

// Delete order
router.delete('/orders/:id/delete', (req, res) => {
  Order.findByIdAndDelete(req.params.id)
    .then((order) => {
      res.json({
        success: true,
        order
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

router.get('/stats', async (req, res) => {
  let now = moment();
  let currentMonth = new Date().getMonth() + 1;
  let currentYear = new Date().getFullYear();
  let today = moment().startOf('day');
  let week = moment().startOf('week');
  let month = moment().startOf('month');
  let year = moment().startOf('year');
  let overAll = moment('2019-01-01');
  let stats = {};

  stats.today = await fetchRecords(today, now);
  stats.currentWeek = await fetchRecords(week, now);
  stats.currentMonth = await fetchRecords(month, now);
  stats.currentYear = await fetchRecords(year, now);
  stats.allTime = await fetchRecords(overAll, now);

  const months = ['Janury', 'Feb', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  let y = currentYear;
  for (let i = 1; i < 13; i++) {
    let _month = moment(new Date(`${y}/${i}`));
    let _endMonth = _month.clone();
    if (!stats.hasOwnProperty(y))
      stats[y] = {};
    stats[y][months[i - 1]] = await fetchRecords(_month.startOf('month'), _endMonth.endOf('month'));
    if (i == currentMonth)
      y = currentYear - 1;
  }

  res.json({
    success: true,
    stats
  });

});

async function fetchRecords(startDate, endDate) {
  let orders = await Order.find({ createdAt: { $gte: new Date(startDate.format()), $lte: new Date(endDate.format()) } }, { totalPrice: 1, totalItems: 1, _id: 0 });
  if (orders.length > 0) {
    return {
      totalItems: orders.reduce((sum, item) => sum + item.totalItems, 0),
      totalPrice: orders.reduce((sum, item) => sum + item.totalPrice, 0)
    }
  } else {
    return {
      totalItems: 0,
      totalPrice: 0.0
    }
  }
}

module.exports = (app) => {
  app.use('/', router);
};
