// routes/chat.routes.js
const express = require('express');
const router  = express.Router();
const authenticate = require('../middlewares/auth.middleware');
const {
  getConversations, createConversation,
  getMessages, sendMessage, deleteMessage,
  getUsers, emitTyping
} = require('../controllers/chat.controller');

router.get   ('/users',                        authenticate, getUsers);
router.get   ('/conversations',                authenticate, getConversations);
router.post  ('/conversations',                authenticate, createConversation);
router.get   ('/conversations/:id/messages',   authenticate, getMessages);
router.post  ('/conversations/:id/messages',   authenticate, sendMessage);
router.delete('/messages/:id',                 authenticate, deleteMessage);
router.post  ('/typing',                       authenticate, emitTyping);

module.exports = router;

