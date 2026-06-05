const User = require('../models/User');
const { asyncHandler, AppError } = require('../middleware/error');
const { uploadToCloudinary } = require('../utils/cloudinary');

// GET /api/users
exports.getUsers = asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;
  const query = { _id: { $ne: req.user._id } };

  if (search) {
    query.$or = [
      { username: { $regex: search, $options: 'i' } },
      { email:    { $regex: search, $options: 'i' } },
    ];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const users = await User.find(query)
    .select('username profilePic bio isOnline lastSeen friends sentRequests friendRequests')
    .sort({ isOnline: -1, username: 1 })
    .skip(skip)
    .limit(Number(limit));

  res.json({ success: true, users });
});

// GET /api/users/:id
exports.getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id)
    .select('-password -socketId')
    .populate('friends', 'username profilePic isOnline lastSeen');

  if (!user) throw new AppError('User not found', 404);
  res.json({ success: true, user });
});

// PUT /api/users/profile
exports.updateProfile = asyncHandler(async (req, res) => {
  const { username, bio, profilePicBase64 } = req.body;
  const updates = {};

  if (username) {
    const exists = await User.findOne({ username, _id: { $ne: req.user._id } });
    if (exists) throw new AppError('Username already taken', 400);
    updates.username = username;
  }

  if (bio !== undefined) updates.bio = bio;

  if (profilePicBase64) {
    const url = await uploadToCloudinary(profilePicBase64, 'chatapp/profiles');
    updates.profilePic = url || profilePicBase64;
  }

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true, runValidators: true })
    .populate('friends', 'username profilePic isOnline lastSeen')
    .populate('friendRequests', 'username profilePic bio');

  res.json({ success: true, message: 'Profile updated', user: user.toPublic() });
});

// POST /api/users/friend-request/:id — send friend request
exports.sendFriendRequest = asyncHandler(async (req, res) => {
  const targetId = req.params.id;
  if (targetId === req.user._id.toString())
    throw new AppError("Can't send request to yourself", 400);

  const target = await User.findById(targetId);
  if (!target) throw new AppError('User not found', 404);

  const meId = req.user._id.toString();

  if (req.user.friends.map(String).includes(targetId))
    throw new AppError('Already friends', 400);
  if (req.user.sentRequests.map(String).includes(targetId))
    throw new AppError('Request already sent', 400);
  if (req.user.friendRequests.map(String).includes(targetId))
    throw new AppError('This user already sent you a request', 400);

  await User.findByIdAndUpdate(meId,     { $addToSet: { sentRequests:   targetId } });
  await User.findByIdAndUpdate(targetId, { $addToSet: { friendRequests: meId     } });

  // Return fresh sender data so frontend can update sentRequests list
  const updated = await User.findById(meId)
    .populate('friends', 'username profilePic isOnline lastSeen')
    .populate('friendRequests', 'username profilePic bio')
    .populate('sentRequests', 'username profilePic');

  res.json({ success: true, message: 'Friend request sent', user: updated.toPublic() });
});

// POST /api/users/accept-request/:id
exports.acceptFriendRequest = asyncHandler(async (req, res) => {
  const senderId = req.params.id;
  const meId = req.user._id.toString();

  const freshMe = await User.findById(meId);
  if (!freshMe.friendRequests.map(String).includes(senderId))
    throw new AppError('No friend request from this user', 400);

  await User.findByIdAndUpdate(meId, {
    $addToSet: { friends: senderId },
    $pull:     { friendRequests: senderId },
  });
  await User.findByIdAndUpdate(senderId, {
    $addToSet: { friends: meId },
    $pull:     { sentRequests: meId },
  });

  // Return both updated users so the frontend can sync properly
  const [updatedMe, updatedSender] = await Promise.all([
    User.findById(meId)
      .populate('friends',        'username profilePic isOnline lastSeen')
      .populate('friendRequests', 'username profilePic bio')
      .populate('sentRequests',   'username profilePic'),
    User.findById(senderId)
      .select('username profilePic isOnline lastSeen'),
  ]);

  res.json({
    success: true,
    message: 'Friend request accepted',
    user:   updatedMe.toPublic(),
    newFriend: updatedSender,
  });
});

// POST /api/users/reject-request/:id
exports.rejectFriendRequest = asyncHandler(async (req, res) => {
  const senderId = req.params.id;
  const meId = req.user._id.toString();

  await User.findByIdAndUpdate(meId,     { $pull: { friendRequests: senderId } });
  await User.findByIdAndUpdate(senderId, { $pull: { sentRequests:   meId     } });

  const updated = await User.findById(meId)
    .populate('friends',        'username profilePic isOnline lastSeen')
    .populate('friendRequests', 'username profilePic bio');

  res.json({ success: true, message: 'Friend request rejected', user: updated.toPublic() });
});

// DELETE /api/users/friend/:id
exports.removeFriend = asyncHandler(async (req, res) => {
  const friendId = req.params.id;
  const meId = req.user._id.toString();

  await User.findByIdAndUpdate(meId,     { $pull: { friends: friendId } });
  await User.findByIdAndUpdate(friendId, { $pull: { friends: meId     } });

  const updated = await User.findById(meId)
    .populate('friends', 'username profilePic isOnline lastSeen')
    .populate('friendRequests', 'username profilePic bio');

  res.json({ success: true, message: 'Friend removed', user: updated.toPublic() });
});
