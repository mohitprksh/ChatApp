const router = require('express').Router();
const {
  getUsers,
  getUserById,
  updateProfile,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
} = require('../controllers/userController');
const { protect } = require('../middleware/auth');

// IMPORTANT: specific routes must be declared before param routes (:id)
// otherwise "profile", "friend-request", etc. would be treated as :id values
router.get('/',              protect, getUsers);
router.put('/profile',       protect, updateProfile);

// Friend actions
router.post('/friend-request/:id',  protect, sendFriendRequest);
router.post('/accept-request/:id',  protect, acceptFriendRequest);
router.post('/reject-request/:id',  protect, rejectFriendRequest);
router.delete('/friend/:id',        protect, removeFriend);

// Param route last
router.get('/:id',           protect, getUserById);

module.exports = router;
