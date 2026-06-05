import { useEffect, useState, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  fetchUsers, setSelectedUser, fetchUnreadCounts,
} from '../../store/slices/chatSlice';
import {
  logout,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
} from '../../store/slices/authSlice';
import Avatar from '../common/Avatar';
import { SkeletonContact } from '../common/Skeleton';
import { formatLastSeen } from '../../utils/helpers';
import { useSocket } from '../../context/SocketContext';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';

// ── Small icon components ────────────────────────────────────────────────────
const IconSearch   = () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>;
const IconLogout   = () => <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>;
const IconUserPlus = () => <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>;
const IconCheck    = () => <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>;
const IconX        = () => <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>;
const IconClock    = () => <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>;
const IconTrash    = () => <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>;

// ── Context menu for friend actions ─────────────────────────────────────────
function FriendMenu({ onRemove, onClose }) {
  return (
    <div
      className="absolute right-0 top-8 z-50 bg-white dark:bg-zinc-800 border border-zinc-200
        dark:border-zinc-700 rounded-xl shadow-lg py-1 min-w-[130px]"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => { onRemove(); onClose(); }}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-red-500
          hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
      >
        <IconTrash /> Remove friend
      </button>
    </div>
  );
}

// ── Friend request card ──────────────────────────────────────────────────────
function RequestCard({ reqUser, onAccept, onReject, processing }) {
  return (
    <div className="flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors group">
      <Avatar user={reqUser} size="md" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">
          {reqUser.username}
        </p>
        {reqUser.bio && (
          <p className="text-xs text-zinc-400 truncate mt-0.5">{reqUser.bio}</p>
        )}
        <div className="flex gap-1.5 mt-2">
          <button
            onClick={() => onAccept(reqUser._id)}
            disabled={processing === reqUser._id}
            className="flex items-center gap-1 px-3 py-1.5 bg-iris-600 hover:bg-iris-500
              text-white text-xs rounded-lg font-semibold disabled:opacity-50 transition-colors"
          >
            <IconCheck />
            {processing === reqUser._id ? 'Accepting…' : 'Accept'}
          </button>
          <button
            onClick={() => onReject(reqUser._id)}
            disabled={processing === reqUser._id + '-r'}
            className="flex items-center gap-1 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-700
              text-zinc-600 dark:text-zinc-300 text-xs rounded-lg font-semibold
              hover:bg-zinc-200 dark:hover:bg-zinc-600 disabled:opacity-50 transition-colors"
          >
            <IconX />
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Sidebar ─────────────────────────────────────────────────────────────
export default function Sidebar({ onShowProfile }) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { users, usersLoading, selectedUser, unreadCounts } = useSelector((s) => s.chat);
  const { user } = useSelector((s) => s.auth);
  const { typingUsers, emitFriendRequest, emitFriendAccepted } = useSocket();

  const [tab,          setTab]          = useState('all');   // 'all' | 'friends' | 'requests'
  const [localSearch,  setLocalSearch]  = useState('');
  const [processing,   setProcessing]   = useState(null);    // userId being acted on
  const [menuOpen,     setMenuOpen]     = useState(null);    // userId with open context menu
  const [addingId,     setAddingId]     = useState(null);    // userId being added as friend

  // Load users on mount + search change
  useEffect(() => {
    dispatch(fetchUsers({ search: localSearch || undefined }));
    dispatch(fetchUnreadCounts());
  }, [localSearch, dispatch]);

  // Periodic unread refresh
  useEffect(() => {
    const iv = setInterval(() => dispatch(fetchUnreadCounts()), 15000);
    return () => clearInterval(iv);
  }, [dispatch]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const friendIds    = new Set((user?.friends || []).map(f => (f._id || f).toString()));
  const sentIds      = new Set((user?.sentRequests || []).map(r => (r._id || r).toString()));
  const requestUsers = (user?.friendRequests || []).filter(r => typeof r === 'object');
  const pendingReqCount = (user?.friendRequests || []).length;

  let displayUsers = users;
  if (tab === 'friends') {
    displayUsers = users.filter(u => friendIds.has(u._id));
  }

  const onlineCount = users.filter(u => u.isOnline).length;

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSelect = useCallback((u) => dispatch(setSelectedUser(u)), [dispatch]);

  const handleSendRequest = useCallback(async (targetId) => {
    setAddingId(targetId);
    try {
      await dispatch(sendFriendRequest(targetId)).unwrap();
      emitFriendRequest(targetId); // real-time notify
    } catch {}
    finally { setAddingId(null); }
  }, [dispatch, emitFriendRequest]);

  const handleAccept = useCallback(async (senderId) => {
    setProcessing(senderId);
    try {
      await dispatch(acceptFriendRequest(senderId)).unwrap();
      emitFriendAccepted(senderId); // real-time notify sender
      dispatch(fetchUsers({}));     // refresh list
    } catch {}
    finally { setProcessing(null); }
  }, [dispatch, emitFriendAccepted]);

  const handleReject = useCallback(async (senderId) => {
    setProcessing(senderId + '-r');
    try {
      await dispatch(rejectFriendRequest(senderId)).unwrap();
    } catch {}
    finally { setProcessing(null); }
  }, [dispatch]);

  const handleRemoveFriend = useCallback(async (friendId) => {
    try {
      await dispatch(removeFriend(friendId)).unwrap();
      dispatch(fetchUsers({}));
    } catch {}
  }, [dispatch]);

  const handleLogout = async () => {
    await dispatch(logout());
    navigate('/login');
  };

  // ── Render helper: add-friend button ──────────────────────────────────────
  const renderAddButton = (u) => {
    if (friendIds.has(u._id)) return null; // already friends
    if (sentIds.has(u._id)) {
      return (
        <span className="flex items-center gap-1 text-[10px] text-zinc-400 dark:text-zinc-500 px-1" title="Request pending">
          <IconClock /> Pending
        </span>
      );
    }
    return (
      <button
        onClick={(e) => { e.stopPropagation(); handleSendRequest(u._id); }}
        disabled={addingId === u._id}
        title="Send friend request"
        className="flex items-center gap-0.5 flex-shrink-0 text-[11px] text-iris-500
          hover:text-iris-700 dark:hover:text-iris-300 font-semibold px-1.5 py-1
          rounded-lg hover:bg-iris-50 dark:hover:bg-iris-900/20 disabled:opacity-50
          transition-colors"
      >
        {addingId === u._id ? '…' : <><IconUserPlus /><span className="ml-0.5">Add</span></>}
      </button>
    );
  };

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <aside className="w-80 flex-shrink-0 flex flex-col bg-white dark:bg-zinc-900 border-r border-zinc-100 dark:border-zinc-800 h-full">

      {/* ── Header ── */}
      <div className="px-4 pt-5 pb-3">
        <div className="flex items-center justify-between mb-4">
          <h1 className="font-display text-xl font-bold text-zinc-900 dark:text-white tracking-tight">
            💬 ChatApp
          </h1>
          <div className="flex items-center gap-1">
            <button onClick={() => onShowProfile?.(user)} className="btn-icon" title="My Profile">
              <Avatar user={user} size="sm" />
            </button>
            <button
              onClick={handleLogout}
              className="btn-icon text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
              title="Logout"
            >
              <IconLogout />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"><IconSearch /></span>
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search users…"
            className="input pl-9 py-2 text-sm"
          />
        </div>

        {/* Online badge */}
        <div className="flex items-center gap-2 mt-3">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs text-zinc-400 dark:text-zinc-500">{onlineCount} online</span>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-zinc-100 dark:border-zinc-800 mx-4">
        {[
          { key: 'all',      label: 'All' },
          { key: 'friends',  label: 'Friends',  badge: 0 },
          { key: 'requests', label: 'Requests', badge: pendingReqCount },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2.5 text-xs font-semibold relative transition-colors
              ${tab === t.key
                ? 'text-iris-600 dark:text-iris-400 border-b-2 border-iris-600 dark:border-iris-400 -mb-px'
                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'}`}
          >
            {t.label}
            {t.badge > 0 && (
              <span className="badge ml-1 text-[9px]">{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto py-2 px-2">

        {/* ── Friend Requests tab ── */}
        {tab === 'requests' && (
          <>
            {requestUsers.length === 0 ? (
              <div className="text-center py-16 text-zinc-400 dark:text-zinc-500">
                <p className="text-4xl mb-3">👋</p>
                <p className="text-sm font-medium">No pending requests</p>
                <p className="text-xs mt-1 text-zinc-300 dark:text-zinc-600">
                  Switch to All tab to find people
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 px-3 pt-2 pb-1 uppercase tracking-wide">
                  {requestUsers.length} pending {requestUsers.length === 1 ? 'request' : 'requests'}
                </p>
                {requestUsers.map((req) => (
                  <RequestCard
                    key={req._id}
                    reqUser={req}
                    onAccept={handleAccept}
                    onReject={handleReject}
                    processing={processing}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ── All / Friends tabs ── */}
        {tab !== 'requests' && (
          <>
            {/* Section label for friends tab */}
            {tab === 'friends' && displayUsers.length > 0 && (
              <p className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 px-3 pt-2 pb-1 uppercase tracking-wide">
                {displayUsers.length} {displayUsers.length === 1 ? 'friend' : 'friends'}
              </p>
            )}

            {usersLoading ? (
              [...Array(6)].map((_, i) => <SkeletonContact key={i} />)
            ) : displayUsers.length === 0 ? (
              <div className="text-center py-16 text-zinc-400 dark:text-zinc-500">
                <p className="text-4xl mb-3">{tab === 'friends' ? '🤝' : '👤'}</p>
                <p className="text-sm font-medium">
                  {tab === 'friends' ? 'No friends yet' : 'No users found'}
                </p>
                {tab === 'friends' && (
                  <p className="text-xs mt-1 text-zinc-300 dark:text-zinc-600">
                    Go to All tab and hit Add to connect
                  </p>
                )}
              </div>
            ) : (
              displayUsers.map((u) => {
                const isSelected = selectedUser?._id === u._id;
                const unread     = unreadCounts[u._id] || 0;
                const isFriend   = friendIds.has(u._id);
                const isTy       = typingUsers[u._id];
                const isMenuOpen = menuOpen === u._id;

                return (
                  <div key={u._id} className="relative">
                    <button
                      onClick={() => handleSelect(u)}
                      className={`contact-item w-full ${isSelected ? 'active' : ''}`}
                    >
                      <Avatar user={u} size="md" showOnline />

                      <div className="flex-1 min-w-0 text-left">
                        <div className="flex items-center justify-between gap-1">
                          <span className={`text-sm font-semibold truncate
                            ${isSelected ? 'text-iris-700 dark:text-iris-300' : 'text-zinc-800 dark:text-zinc-100'}`}>
                            {u.username}
                            {isFriend && (
                              <span className="ml-1.5 text-[9px] font-bold text-emerald-500
                                bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded-full align-middle">
                                Friend
                              </span>
                            )}
                          </span>
                          {unread > 0 && <span className="badge flex-shrink-0">{unread}</span>}
                        </div>
                        <p className={`text-xs truncate mt-0.5
                          ${isSelected ? 'text-iris-500' : 'text-zinc-400 dark:text-zinc-500'}`}>
                          {isTy
                            ? <span className="text-iris-500 font-medium">typing…</span>
                            : (u.bio || (u.isOnline ? 'Online' : `Last seen ${formatLastSeen(u.lastSeen)}`))}
                        </p>
                      </div>

                      {/* Action button area */}
                      <div className="flex-shrink-0 flex items-center">
                        {isFriend ? (
                          /* ⋯ menu for friends */
                          <button
                            onClick={(e) => { e.stopPropagation(); setMenuOpen(isMenuOpen ? null : u._id); }}
                            className="btn-icon w-7 h-7 text-zinc-400 hover:text-zinc-600
                              dark:hover:text-zinc-300 opacity-0 group-hover:opacity-100
                              transition-opacity text-base leading-none"
                            title="Options"
                          >
                            ⋯
                          </button>
                        ) : (
                          renderAddButton(u)
                        )}
                      </div>
                    </button>

                    {/* Context menu */}
                    {isMenuOpen && (
                      <FriendMenu
                        onRemove={() => handleRemoveFriend(u._id)}
                        onClose={() => setMenuOpen(null)}
                      />
                    )}
                  </div>
                );
              })
            )}
          </>
        )}
      </div>

      {/* ── Footer: current user ── */}
      <div className="px-4 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-3">
        <Avatar user={user} size="sm" showOnline />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 truncate">
            {user?.username}
          </p>
          <p className="text-[10px] text-emerald-500 font-medium">● Online</p>
        </div>
        <div className="text-xs text-zinc-400 dark:text-zinc-500 text-right leading-tight">
          <p>{friendIds.size} friends</p>
        </div>
      </div>
    </aside>
  );
}
