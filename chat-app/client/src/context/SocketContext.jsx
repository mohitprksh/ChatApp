import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useSelector, useDispatch } from 'react-redux';
import {
  addMessage, updateMessage, deleteMessage as deleteMsg,
  setMessageReactions, setUserOnline, setUserOffline,
} from '../store/slices/chatSlice';
import {
  addFriendRequest,
  friendRequestAcceptedByPeer,
  setFriendOnline,
  setFriendOffline,
} from '../store/slices/authSlice';
import toast from 'react-hot-toast';

const SocketContext = createContext(null);
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

export const SocketProvider = ({ children }) => {
  const socketRef = useRef(null);
  const dispatch  = useDispatch();

  const token  = useSelector((s) => s.auth.token);
  const userId = useSelector((s) => s.auth.user?._id);

  const selectedUser    = useSelector((s) => s.chat.selectedUser);
  const selectedUserRef = useRef(selectedUser);
  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);

  const [isConnected, setIsConnected] = useState(false);
  const [typingUsers,  setTypingUsers] = useState({});

  useEffect(() => {
    if (!token || !userId) return;
    if (socketRef.current?.connected) return;

    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect',       () => { console.log('🔌 Socket connected:', socket.id); setIsConnected(true); });
    socket.on('disconnect',    (r) => { console.log('❌ Socket disconnected:', r); setIsConnected(false); });
    socket.on('connect_error', (e) => { console.error('Socket error:', e.message); });

    // ── Online / Offline ────────────────────────────
    socket.on('onlineUsers', (userIds) => userIds.forEach((id) => dispatch(setUserOnline(id))));
    socket.on('userOnline',  ({ userId }) => { dispatch(setUserOnline(userId)); dispatch(setFriendOnline(userId)); });
    socket.on('userOffline', ({ userId, lastSeen }) => { dispatch(setUserOffline({ userId, lastSeen })); dispatch(setFriendOffline({ userId, lastSeen })); });

    // ── Messages ─────────────────────────────────────
    socket.on('receiveMessage', (msg) => {
      dispatch(addMessage(msg));
      if (msg.senderId !== selectedUserRef.current?._id) {
        toast(`New message from ${msg.senderUsername || 'someone'}`, { icon: '💬', duration: 3000 });
      }
    });
    socket.on('messageSent',     (msg)                    => dispatch(addMessage(msg)));
    socket.on('messageEdited',   (msg)                    => dispatch(updateMessage(msg)));
    socket.on('messageDeleted',  ({ messageId })          => dispatch(deleteMsg(messageId)));
    socket.on('messageReacted',  ({ messageId, reactions }) => dispatch(setMessageReactions({ messageId, reactions })));
    socket.on('messagesSeen',    ({ messageIds })         => messageIds.forEach((id) => dispatch(updateMessage({ _id: id, status: 'seen' }))));
    socket.on('messageDelivered',({ messageId })          => dispatch(updateMessage({ _id: messageId, status: 'delivered' })));

    // ── Typing ────────────────────────────────────────
    socket.on('typing', ({ senderId, isTyping }) =>
      setTypingUsers((prev) => ({ ...prev, [senderId]: isTyping }))
    );

    // ── Friend Requests (real-time) ───────────────────
    // Someone sent YOU a request
    socket.on('newFriendRequest', (from) => {
      dispatch(addFriendRequest(from));
      toast(`${from.username} sent you a friend request 👋`, { duration: 4000 });
    });

    // Someone accepted YOUR request
    socket.on('friendRequestAccepted', (by) => {
      dispatch(friendRequestAcceptedByPeer({ by }));
      toast(`${by.username} accepted your friend request! 🎉`, { duration: 4000 });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [token, userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage        = useCallback((data)                 => socketRef.current?.emit('sendMessage', data), []);
  const emitTyping         = useCallback((receiverId, isTyping) => socketRef.current?.emit('typing', { receiverId, isTyping }), []);
  const markSeen           = useCallback((senderId, messageIds) => socketRef.current?.emit('messageSeen', { senderId, messageIds }), []);
  const editMessage        = useCallback((data)                 => socketRef.current?.emit('editMessage', data), []);
  const deleteMessage      = useCallback((data)                 => socketRef.current?.emit('deleteMessage', data), []);
  const reactToMessage     = useCallback((data)                 => socketRef.current?.emit('reactToMessage', data), []);
  const emitFriendRequest  = useCallback((receiverId)           => socketRef.current?.emit('friendRequest', { receiverId }), []);
  const emitFriendAccepted = useCallback((receiverId)           => socketRef.current?.emit('friendRequestAccepted', { receiverId }), []);

  return (
    <SocketContext.Provider value={{
      socket: socketRef.current, isConnected, typingUsers,
      sendMessage, emitTyping, markSeen, editMessage, deleteMessage,
      reactToMessage, emitFriendRequest, emitFriendAccepted,
    }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => useContext(SocketContext);
