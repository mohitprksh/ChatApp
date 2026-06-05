import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { authAPI, userAPI } from '../../services/api';
import toast from 'react-hot-toast';

// ─── Thunks ─────────────────────────────────────────────────────────────────

export const register = createAsyncThunk('auth/register', async (data, { rejectWithValue }) => {
  try {
    const res = await authAPI.register(data);
    localStorage.setItem('token', res.data.token);
    return res.data;
  } catch (e) { return rejectWithValue(e.response?.data?.message || 'Registration failed'); }
});

export const login = createAsyncThunk('auth/login', async (data, { rejectWithValue }) => {
  try {
    const res = await authAPI.login(data);
    localStorage.setItem('token', res.data.token);
    return res.data;
  } catch (e) { return rejectWithValue(e.response?.data?.message || 'Login failed'); }
});

export const logout = createAsyncThunk('auth/logout', async () => {
  try { await authAPI.logout(); } catch {}
  localStorage.removeItem('token');
});

export const getMe = createAsyncThunk('auth/getMe', async (_, { rejectWithValue }) => {
  try {
    const res = await authAPI.getMe();
    return res.data;
  } catch (e) { return rejectWithValue(e.response?.data?.message || 'Failed'); }
});

export const updateProfile = createAsyncThunk('auth/updateProfile', async (data, { rejectWithValue }) => {
  try {
    const res = await userAPI.updateProfile(data);
    return res.data;
  } catch (e) { return rejectWithValue(e.response?.data?.message || 'Update failed'); }
});

export const sendFriendRequest = createAsyncThunk('auth/sendFriendRequest', async (targetId, { rejectWithValue }) => {
  try {
    const res = await userAPI.sendFriendRequest(targetId);
    return res.data; // { user } — updated current user with new sentRequests
  } catch (e) { return rejectWithValue(e.response?.data?.message || 'Failed to send request'); }
});

export const acceptFriendRequest = createAsyncThunk('auth/acceptFriendRequest', async (senderId, { rejectWithValue }) => {
  try {
    const res = await userAPI.acceptFriendRequest(senderId);
    return res.data; // { user, newFriend }
  } catch (e) { return rejectWithValue(e.response?.data?.message || 'Failed to accept request'); }
});

export const rejectFriendRequest = createAsyncThunk('auth/rejectFriendRequest', async (senderId, { rejectWithValue }) => {
  try {
    const res = await userAPI.rejectFriendRequest(senderId);
    return res.data; // { user }
  } catch (e) { return rejectWithValue(e.response?.data?.message || 'Failed to reject request'); }
});

export const removeFriend = createAsyncThunk('auth/removeFriend', async (friendId, { rejectWithValue }) => {
  try {
    const res = await userAPI.removeFriend(friendId);
    return res.data; // { user }
  } catch (e) { return rejectWithValue(e.response?.data?.message || 'Failed to remove friend'); }
});

// ─── Slice ───────────────────────────────────────────────────────────────────

const authSlice = createSlice({
  name: 'auth',
  initialState: {
    user: null,
    token: localStorage.getItem('token'),
    isAuthenticated: false,
    loading: false,
    initialized: false,
    error: null,
  },
  reducers: {
    clearError: (s) => { s.error = null; },

    // Called from SocketContext when a friend request arrives via socket
    addFriendRequest: (s, a) => {
      if (!s.user) return;
      const already = s.user.friendRequests?.some(r =>
        (r._id || r) === (a.payload._id || a.payload)
      );
      if (!already) {
        s.user.friendRequests = [...(s.user.friendRequests || []), a.payload];
      }
    },

    // Called from SocketContext when a friend accepts your request via socket
    friendRequestAcceptedByPeer: (s, a) => {
      // a.payload = { by: publicUser }
      if (!s.user) return;
      const peer = a.payload.by;
      // Remove from sentRequests
      s.user.sentRequests = (s.user.sentRequests || []).filter(r =>
        (r._id || r).toString() !== peer._id.toString()
      );
      // Add to friends if not already there
      const alreadyFriend = s.user.friends?.some(f =>
        (f._id || f).toString() === peer._id.toString()
      );
      if (!alreadyFriend) {
        s.user.friends = [...(s.user.friends || []), peer];
      }
    },

    setFriendOnline: (s, a) => {
      if (!s.user?.friends) return;
      s.user.friends = s.user.friends.map(f =>
        (f._id || f).toString() === a.payload ? { ...f, isOnline: true } : f
      );
    },
    setFriendOffline: (s, a) => {
      if (!s.user?.friends) return;
      s.user.friends = s.user.friends.map(f =>
        (f._id || f).toString() === a.payload.userId
          ? { ...f, isOnline: false, lastSeen: a.payload.lastSeen }
          : f
      );
    },
  },

  extraReducers: (b) => {
    const pending  = (s) => { s.loading = true; s.error = null; };
    const rejected = (s, a) => { s.loading = false; s.error = a.payload; toast.error(a.payload); };

    b.addCase(register.pending, pending)
     .addCase(register.fulfilled, (s, a) => {
       s.loading = false; s.user = a.payload.user;
       s.token = a.payload.token; s.isAuthenticated = true;
       toast.success('Welcome to ChatApp! 🎉');
     })
     .addCase(register.rejected, rejected);

    b.addCase(login.pending, pending)
     .addCase(login.fulfilled, (s, a) => {
       s.loading = false; s.user = a.payload.user;
       s.token = a.payload.token; s.isAuthenticated = true;
       toast.success(`Hey ${a.payload.user.username}! 👋`);
     })
     .addCase(login.rejected, rejected);

    b.addCase(logout.fulfilled, (s) => {
      s.user = null; s.token = null; s.isAuthenticated = false; s.initialized = false;
    });

    b.addCase(getMe.pending, (s) => { s.loading = true; })
     .addCase(getMe.fulfilled, (s, a) => {
       s.loading = false; s.user = a.payload.user;
       s.isAuthenticated = true; s.initialized = true;
     })
     .addCase(getMe.rejected, (s) => {
       s.loading = false; s.isAuthenticated = false;
       s.initialized = true; s.token = null;
       localStorage.removeItem('token');
     });

    b.addCase(updateProfile.fulfilled, (s, a) => {
       s.user = { ...s.user, ...a.payload.user };
       toast.success('Profile updated!');
     })
     .addCase(updateProfile.rejected, (_, a) => toast.error(a.payload));

    // sendFriendRequest → update sentRequests in store
    b.addCase(sendFriendRequest.fulfilled, (s, a) => {
      s.user = { ...s.user, ...a.payload.user };
      toast.success('Friend request sent! 👋');
    })
    .addCase(sendFriendRequest.rejected, (_, a) => toast.error(a.payload));

    // acceptFriendRequest → full user refresh from server
    b.addCase(acceptFriendRequest.fulfilled, (s, a) => {
      s.user = { ...s.user, ...a.payload.user };
      toast.success('Friend added! 🎉');
    })
    .addCase(acceptFriendRequest.rejected, (_, a) => toast.error(a.payload));

    // rejectFriendRequest → remove from friendRequests list
    b.addCase(rejectFriendRequest.fulfilled, (s, a) => {
      s.user = { ...s.user, ...a.payload.user };
      toast.success('Request declined');
    })
    .addCase(rejectFriendRequest.rejected, (_, a) => toast.error(a.payload));

    // removeFriend → remove from friends list
    b.addCase(removeFriend.fulfilled, (s, a) => {
      s.user = { ...s.user, ...a.payload.user };
      toast.success('Friend removed');
    })
    .addCase(removeFriend.rejected, (_, a) => toast.error(a.payload));
  },
});

export const {
  clearError,
  addFriendRequest,
  friendRequestAcceptedByPeer,
  setFriendOnline,
  setFriendOffline,
} = authSlice.actions;
export default authSlice.reducer;
