const User    = require('../models/User');
const Message = require('../models/Message');
const { verifySocketToken } = require('../middleware/auth');

// Map  userId (string) -> Set<socketId>
const onlineUsers = new Map();

const getSocketId = (userId) => {
  const sockets = onlineUsers.get(userId.toString());
  return sockets ? [...sockets][0] : null;
};

module.exports = (io) => {

  // ── Auth middleware ──────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('Authentication required'));

      const decoded = verifySocketToken(token);
      if (!decoded)  return next(new Error('Invalid token'));

      const user = await User.findById(decoded.id).select('-password');
      if (!user)     return next(new Error('User not found'));

      socket.userId = user._id.toString();
      socket.user   = user;
      next();
    } catch (err) {
      next(new Error('Socket authentication failed'));
    }
  });

  // ── Connection ───────────────────────────────────────────────────────────
  io.on('connection', async (socket) => {
    const userId = socket.userId;
    console.log(`🔌 Connected: ${socket.user.username} | sid=${socket.id} | tabs=${(onlineUsers.get(userId)?.size ?? 0) + 1}`);

    if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
    onlineUsers.get(userId).add(socket.id);

    await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() });

    socket.broadcast.emit('userOnline', { userId });
    socket.emit('onlineUsers', [...onlineUsers.keys()]);
    socket.join(userId);

    // ── Messages ────────────────────────────────────────────────────────
    socket.on('sendMessage', async (data) => {
      try {
        const { receiverId, text, image, replyTo } = data;
        if (!receiverId || (!text && !image)) return;

        const message = await Message.create({
          senderId: userId, receiverId,
          text: text || '', image: image || '',
          replyTo: replyTo || null, status: 'sent',
        });

        await message.populate('replyTo', 'text image senderId');

        const receiverOnline = onlineUsers.has(receiverId) && onlineUsers.get(receiverId).size > 0;
        if (receiverOnline) {
          message.status      = 'delivered';
          message.deliveredAt = new Date();
          await message.save();
          io.to(receiverId).emit('receiveMessage', message);
        }

        io.to(userId).emit('messageSent', message);
        if (receiverOnline) io.to(userId).emit('messageDelivered', { messageId: message._id });
      } catch (err) {
        console.error('sendMessage error:', err);
        socket.emit('messageError', { error: 'Failed to send message' });
      }
    });

    // ── Typing ───────────────────────────────────────────────────────────
    socket.on('typing', ({ receiverId, isTyping }) => {
      io.to(receiverId).emit('typing', { senderId: userId, isTyping });
    });

    // ── Message Seen ─────────────────────────────────────────────────────
    socket.on('messageSeen', async ({ senderId, messageIds }) => {
      try {
        await Message.updateMany(
          { _id: { $in: messageIds }, senderId, receiverId: userId },
          { status: 'seen', seenAt: new Date() }
        );
        io.to(senderId).emit('messagesSeen', { by: userId, messageIds });
      } catch (err) { console.error('messageSeen error:', err); }
    });

    // ── Edit Message ─────────────────────────────────────────────────────
    socket.on('editMessage', async ({ messageId, text, receiverId }) => {
      try {
        const msg = await Message.findOne({ _id: messageId, senderId: userId });
        if (!msg || msg.isDeleted) return;
        msg.text = text; msg.isEdited = true; msg.editedAt = new Date();
        await msg.save();
        io.to(receiverId).emit('messageEdited', msg);
        io.to(userId).emit('messageEdited', msg);
      } catch (err) { console.error('editMessage error:', err); }
    });

    // ── Delete Message ────────────────────────────────────────────────────
    socket.on('deleteMessage', async ({ messageId, receiverId }) => {
      try {
        const msg = await Message.findOne({ _id: messageId, senderId: userId });
        if (!msg) return;
        msg.isDeleted = true; msg.text = ''; msg.image = '';
        await msg.save();
        io.to(receiverId).emit('messageDeleted', { messageId });
        io.to(userId).emit('messageDeleted', { messageId });
      } catch (err) { console.error('deleteMessage error:', err); }
    });

    // ── Reactions ────────────────────────────────────────────────────────
    socket.on('reactToMessage', async ({ messageId, emoji, receiverId }) => {
      try {
        const msg = await Message.findById(messageId);
        if (!msg || msg.isDeleted) return;
        const idx = msg.reactions.findIndex((r) => r.userId.toString() === userId);
        if (idx > -1) {
          if (msg.reactions[idx].emoji === emoji) msg.reactions.splice(idx, 1);
          else msg.reactions[idx].emoji = emoji;
        } else {
          msg.reactions.push({ userId, emoji });
        }
        await msg.save();
        const payload = { messageId, reactions: msg.reactions };
        io.to(receiverId).emit('messageReacted', payload);
        io.to(userId).emit('messageReacted', payload);
      } catch (err) { console.error('reactToMessage error:', err); }
    });

    // ── Friend Request events ────────────────────────────────────────────
    // Notify the receiver that someone sent them a request.
    // Emit the full sender public profile so the frontend gets username + pic
    // without needing an extra API call.
    socket.on('friendRequest', ({ receiverId }) => {
      const senderPublic = socket.user.toPublic();
      io.to(receiverId).emit('newFriendRequest', senderPublic);
    });

    // Notify the original sender that their request was accepted.
    socket.on('friendRequestAccepted', ({ receiverId }) => {
      const accepterPublic = socket.user.toPublic();
      io.to(receiverId).emit('friendRequestAccepted', accepterPublic);
    });

    // ── Disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      console.log(`🔌 Disconnected: ${socket.user.username} | sid=${socket.id} | reason=${reason}`);
      const sockets = onlineUsers.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(userId);
          await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date() });
          socket.broadcast.emit('userOffline', { userId, lastSeen: new Date() });
          console.log(`👤 ${socket.user.username} fully offline`);
        } else {
          console.log(`👤 ${socket.user.username} still has ${sockets.size} tab(s)`);
        }
      }
    });
  });

  return { onlineUsers, getSocketId };
};
