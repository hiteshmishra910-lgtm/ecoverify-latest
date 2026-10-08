import React, { useState, useMemo } from 'react';
import { User } from 'firebase/auth';
import { doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  CollectorRecord,
  GarbageCollectionRecord,
  GovernmentIncentiveProgram,
  ResidentRecord,
  WASTE_CATEGORY_LABELS,
} from '../types';
import {
  LayoutDashboard,
  Users,
  UserCheck,
  Truck,
  ClipboardList,
  MapPin,
  Award,
  Trophy,
  Landmark,
  FileBarChart,
  Settings,
  LogOut,
  ShieldCheck,
  CheckCircle2,
  Plus,
  Menu,
  X,
  Search,
} from 'lucide-react';

type AdminNavTab =
  | 'dashboard'
  | 'residents'
  | 'collectors'
  | 'vehicles'
  | 'collections'
  | 'live-gps'
  | 'rewards'
  | 'leaderboard'
  | 'incentives'
  | 'reports'
  | 'settings';

interface AdminDashboardProps {
  user: User;
  residents: ResidentRecord[];
  collectors: CollectorRecord[];
  collections: GarbageCollectionRecord[];
  incentives: GovernmentIncentiveProgram[];
  onSignOut: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  user,
  residents,
  collectors,
  collections,
  incentives,
  onSignOut,
}) => {
  const [activeNav, setActiveNav] = useState<AdminNavTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCollectionDetail, setSelectedCollectionDetail] =
    useState<GarbageCollectionRecord | null>(null);

  // Leaderboard filters: Daily, Monthly, Yearly, Area
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<
    'ALL' | 'DAILY' | 'MONTHLY' | 'YEARLY'
  >('ALL');
  const [leaderboardArea, setLeaderboardArea] = useState<string>('ALL');

  // Government Incentive form state
  const [programName, setProgramName] = useState('');
  const [eligibility, setEligibility] = useState('');
  const [rewardAmount, setRewardAmount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'UPCOMING' | 'PAUSED' | 'CLOSED'>('ACTIVE');
  const [notes, setNotes] = useState('');
  const [supportingDocuments, setSupportingDocuments] = useState('');
  const [savingIncentive, setSavingIncentive] = useState(false);
  const [incentiveNotice, setIncentiveNotice] = useState<string | null>(null);

  // Admin Register Resident quick form
  const [newResName, setNewResName] = useState('');
  const [newResAddress, setNewResAddress] = useState('');
  const [newResArea, setNewResArea] = useState('');
  const [newResCity, setNewResCity] = useState('');
  const [newResPin, setNewResPin] = useState('');
  const [newResPhone, setNewResPhone] = useState('');
  const [savingResident, setSavingResident] = useState(false);

  const todaysCollectionsCount = useMemo(() => {
    const now = new Date();
    return collections.filter((c) => {
      const sec = c.timestamp?.seconds || c.createdAt?.seconds;
      if (!sec) return true;
      const d = new Date(sec * 1000);
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    }).length;
  }, [collections]);

  const totalRewardsIssued = useMemo(() => {
    const fromCollections = collections.reduce(
      (sum, item) => sum + Number(item.rewardPoints || item.rewardPointsEarned || 0),
      0
    );
    const fromResidents = residents.reduce(
      (sum, r) => sum + Number(r.rewardPoints || 0),
      0
    );
    return Math.max(fromCollections, fromResidents);
  }, [collections, residents]);

  const activeVehiclesList = useMemo(() => {
    const map = new Map<
      string,
      { vehicleId: string; collectorName: string; area: string; pickups: number }
    >();
    collectors.forEach((col) => {
      if (col.vehicleId) {
        map.set(col.vehicleId, {
          vehicleId: col.vehicleId,
          collectorName: col.name,
          area: col.assignedArea,
          pickups: collections.filter(
            (c) => (c.vehicleId || c.vehicleNumber) === col.vehicleId
          ).length,
        });
      }
    });
    collections.forEach((c) => {
      const vId = c.vehicleId || c.vehicleNumber;
      if (vId && !map.has(vId)) {
        map.set(vId, {
          vehicleId: vId,
          collectorName: c.collectorName,
          area: c.area || 'Municipal Zone',
          pickups: collections.filter(
            (x) => (x.vehicleId || x.vehicleNumber) === vId
          ).length,
        });
      }
    });
    return Array.from(map.values());
  }, [collectors, collections]);

  const uniqueAreas = useMemo(() => {
    const s = new Set<string>();
    residents.forEach((r) => {
      if (r.area) s.add(r.area);
    });
    return Array.from(s);
  }, [residents]);

  const leaderboardList = useMemo(() => {
    const now = new Date();
    return residents
      .filter((r) => leaderboardArea === 'ALL' || r.area === leaderboardArea)
      .map((r) => {
        const resCols = collections.filter((c) => {
          const matches =
            c.residentId === r.residentId || c.householdId === r.householdId;
          if (!matches) return false;
          const sec = c.timestamp?.seconds || c.createdAt?.seconds;
          if (!sec || leaderboardPeriod === 'ALL') return true;
          const d = new Date(sec * 1000);
          if (leaderboardPeriod === 'DAILY') {
            return (
              d.getFullYear() === now.getFullYear() &&
              d.getMonth() === now.getMonth() &&
              d.getDate() === now.getDate()
            );
          }
          if (leaderboardPeriod === 'MONTHLY') {
            return (
              d.getFullYear() === now.getFullYear() &&
              d.getMonth() === now.getMonth()
            );
          }
          if (leaderboardPeriod === 'YEARLY') {
            return d.getFullYear() === now.getFullYear();
          }
          return true;
        });

        const periodPoints = resCols.reduce(
          (sum, c) => sum + Number(c.rewardPoints || c.rewardPointsEarned || 0),
          0
        );
        const displayPoints =
          leaderboardPeriod === 'ALL'
            ? Math.max(Number(r.rewardPoints || 0), periodPoints)
            : periodPoints;
        const displayCollections =
          leaderboardPeriod === 'ALL'
            ? Math.max(Number(r.collectionsCount || 0), resCols.length)
            : resCols.length;

        return {
          ...r,
          displayPoints,
          displayCollections,
        };
      })
      .sort((a, b) => b.displayPoints - a.displayPoints);
  }, [residents, collections, leaderboardArea, leaderboardPeriod]);

  const categoryBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    collections.forEach((c) => {
      const label =
        c.wasteType ||
        WASTE_CATEGORY_LABELS[c.wasteCategory] ||
        c.wasteCategory ||
        'Other';
      counts[label] = (counts[label] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [collections]);

  const handleToggleAdminReviewEligibility = async (resident: ResidentRecord) => {
    try {
      const nextVal = !resident.eligibleForAdminReview;
      await updateDoc(doc(db, 'residents', resident.residentId), {
        eligibleForAdminReview: nextVal,
      });
    } catch (err) {
      try {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `residents/${resident.residentId}`
        );
      } catch (e2) {
        console.error(e2);
      }
    }
  };

  const handleCreateResidentByAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingResident(true);
    const generatedId = `RES-${Date.now().toString(36).toUpperCase()}`;
    try {
      await setDoc(doc(db, 'residents', generatedId), {
        residentId: generatedId,
        householdId: generatedId,
        name: newResName.trim().slice(0, 120),
        address: newResAddress.trim().slice(0, 250),
        area: newResArea.trim().slice(0, 120),
        city: newResCity.trim().slice(0, 100),
        pin: newResPin.trim().slice(0, 20),
        phone: newResPhone.trim().slice(0, 30),
        rewardPoints: 0,
        collectionsCount: 0,
        role: 'resident',
        ownerUid: user.uid,
        eligibleForAdminReview: false,
        createdAt: serverTimestamp(),
      });

      await setDoc(doc(db, 'households', generatedId), {
        residentId: generatedId,
        householdId: generatedId,
        token: generatedId,
        name: newResName.trim().slice(0, 120),
        address: newResAddress.trim().slice(0, 250),
        area: newResArea.trim().slice(0, 120),
        city: newResCity.trim().slice(0, 100),
        pinCode: newResPin.trim().slice(0, 20),
        rewardPoints: 0,
        collectionsCount: 0,
        ownerUid: user.uid,
        createdAt: serverTimestamp(),
      });

      setNewResName('');
      setNewResAddress('');
      setNewResArea('');
      setNewResCity('');
      setNewResPin('');
      setNewResPhone('');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, `residents/${generatedId}`);
      } catch (e2) {
        console.error(e2);
      }
    } finally {
      setSavingResident(false);
    }
  };

  const handleCreateGovernmentIncentive = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingIncentive(true);
    setIncentiveNotice(null);
    const incentiveId = `INC-${Date.now().toString(36).toUpperCase()}`;
    try {
      await setDoc(doc(db, 'incentives', incentiveId), {
        incentiveId,
        programName: programName.trim().slice(0, 160),
        eligibility: eligibility.trim().slice(0, 300),
        rewardAmount: rewardAmount.trim().slice(0, 100),
        startDate: startDate.trim().slice(0, 40),
        endDate: endDate.trim().slice(0, 40),
        status,
        notes: (notes.trim() || 'Subject to municipal administrative review.').slice(0, 500),
        supportingDocuments: (
          supportingDocuments.trim() || 'Verified EcoVerify Collection & Household ID Logs'
        ).slice(0, 300),
        createdByUid: user.uid,
        createdAt: serverTimestamp(),
      });

      setProgramName('');
      setEligibility('');
      setRewardAmount('');
      setStartDate('');
      setEndDate('');
      setNotes('');
      setSupportingDocuments('');
      setIncentiveNotice('Government incentive program saved to Firestore.');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, `incentives/${incentiveId}`);
      } catch (e2: any) {
        setIncentiveNotice(`Error: ${e2.message}`);
      }
    } finally {
      setSavingIncentive(false);
    }
  };

  const formatTime = (ts: any) => {
    const sec = ts?.seconds;
    if (!sec) return 'Just now';
    return new Date(sec * 1000).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const navItems: { id: AdminNavTab; label: string; icon: React.ReactNode }[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    { id: 'residents', label: 'Residents', icon: <Users className="w-4 h-4" /> },
    {
      id: 'collectors',
      label: 'Collectors',
      icon: <UserCheck className="w-4 h-4" />,
    },
    { id: 'vehicles', label: 'Vehicles', icon: <Truck className="w-4 h-4" /> },
    {
      id: 'collections',
      label: 'Collections',
      icon: <ClipboardList className="w-4 h-4" />,
    },
    { id: 'live-gps', label: 'Live GPS', icon: <MapPin className="w-4 h-4" /> },
    { id: 'rewards', label: 'Rewards', icon: <Award className="w-4 h-4" /> },
    {
      id: 'leaderboard',
      label: 'Leaderboard',
      icon: <Trophy className="w-4 h-4" />,
    },
    {
      id: 'incentives',
      label: 'Government Incentives',
      icon: <Landmark className="w-4 h-4" />,
    },
    {
      id: 'reports',
      label: 'Reports',
      icon: <FileBarChart className="w-4 h-4" />,
    },
    { id: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="p-5 border-b border-slate-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <span className="text-base font-bold text-slate-900 block leading-none">
              EcoVerify
            </span>
            <span className="text-[11px] font-semibold text-indigo-700 mt-1 block">
              Municipal Admin
            </span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveNav(item.id)}
              className={`w-full px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-3 transition-colors cursor-pointer ${
                activeNav === item.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-100 space-y-3">
          <div className="px-2">
            <p className="text-xs font-bold text-slate-900 truncate">
              {user.displayName || 'Administrator'}
            </p>
            <p className="text-[11px] text-slate-500 truncate">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-red-200 bg-red-50/60 hover:bg-red-100 text-red-700 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="md:hidden sticky top-0 z-30 bg-white border-b border-slate-200 px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-slate-900 text-white flex items-center justify-center">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <span className="text-sm font-bold text-slate-900 block leading-none">
              EcoVerify Admin
            </span>
            <span className="text-[10px] font-semibold text-indigo-700 block">
              Command Console
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setMobileMenuOpen((prev) => !prev)}
          className="min-h-[38px] min-w-[38px] rounded-xl border border-slate-200 flex items-center justify-center text-slate-700"
          aria-label="Toggle Menu"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </header>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-white border-b border-slate-200 px-4 py-3 space-y-1 z-30 max-h-[80vh] overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setActiveNav(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-3 ${
                activeNav === item.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onSignOut}
            className="w-full mt-2 px-3.5 py-2.5 rounded-xl bg-red-50 text-red-700 text-xs font-semibold flex items-center gap-3"
          >
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 md:pl-64 pb-16 md:pb-8">
        <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
          {/* 1. ADMIN DASHBOARD OVERVIEW */}
          {activeNav === 'dashboard' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs">
                <span className="text-xs font-bold text-indigo-700 uppercase">
                  Municipal Waste Verification Command
                </span>
                <h1 className="text-2xl font-bold text-slate-900 mt-0.5">
                  Admin Operations Dashboard
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  Real-time overview of registered residents, active collectors, vehicles, AI waste inspections, and incentive eligibility.
                </p>
              </div>

              {/* 6 Required Admin Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <span className="text-xs font-semibold text-slate-500">
                    Total Residents
                  </span>
                  <p className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 tabular-nums mt-2">
                    {residents.length}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Registered in Firestore
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <span className="text-xs font-semibold text-slate-500">
                    Active Collectors
                  </span>
                  <p className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 tabular-nums mt-2">
                    {collectors.length}
                  </p>
                  <p className="text-xs text-emerald-700 font-medium mt-1">
                    Field verification personnel
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <span className="text-xs font-semibold text-slate-500">
                    Today&apos;s Collections
                  </span>
                  <p className="text-2xl sm:text-3xl font-bold font-mono text-emerald-700 tabular-nums mt-2">
                    {todaysCollectionsCount}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Verified pickups today
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <span className="text-xs font-semibold text-slate-500">
                    Total Waste Collected
                  </span>
                  <p className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 tabular-nums mt-2">
                    {collections.length}
                  </p>
                  <p className="text-xs text-indigo-700 font-medium mt-1">
                    AI-verified collection logs
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <span className="text-xs font-semibold text-slate-500">
                    Total Rewards
                  </span>
                  <p className="text-2xl sm:text-3xl font-bold font-mono text-emerald-700 tabular-nums mt-2">
                    {totalRewardsIssued}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Total reward points issued
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <span className="text-xs font-semibold text-slate-500">
                    Active Vehicles
                  </span>
                  <p className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 tabular-nums mt-2">
                    {activeVehiclesList.length}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Assigned collection fleet
                  </p>
                </div>
              </div>

              {/* Latest Verified Collections Preview */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-900">
                    Latest Verified Collections
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveNav('collections')}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                  >
                    Open Full Collections Log →
                  </button>
                </div>

                {collections.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500">
                    No collections recorded yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2.5 px-3 font-semibold">Resident</th>
                          <th className="py-2.5 px-3 font-semibold">Household ID</th>
                          <th className="py-2.5 px-3 font-semibold">Waste Type</th>
                          <th className="py-2.5 px-3 font-semibold">Collector</th>
                          <th className="py-2.5 px-3 font-semibold">GPS</th>
                          <th className="py-2.5 px-3 font-semibold text-right">Reward</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {collections.slice(0, 6).map((c) => (
                          <tr
                            key={c.collectionId}
                            onClick={() => setSelectedCollectionDetail(c)}
                            className="hover:bg-slate-50 cursor-pointer"
                          >
                            <td className="py-3 px-3 font-semibold text-slate-900">
                              {c.residentName}
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-700">
                              {c.householdId}
                            </td>
                            <td className="py-3 px-3 font-semibold text-indigo-700">
                              {c.wasteType || WASTE_CATEGORY_LABELS[c.wasteCategory]} (
                              {c.confidence}%)
                            </td>
                            <td className="py-3 px-3 text-slate-700">
                              {c.collectorName} ({c.vehicleId || c.vehicleNumber})
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-600 tabular-nums">
                              {c.latitude}, {c.longitude}
                            </td>
                            <td className="py-3 px-3 font-mono font-bold text-right text-emerald-700">
                              +{c.rewardPoints || c.rewardPointsEarned} pts
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. RESIDENTS MANAGEMENT */}
          {activeNav === 'residents' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-4">
                <h1 className="text-xl font-bold text-slate-900">
                  Register New Resident Household
                </h1>
                <form
                  onSubmit={handleCreateResidentByAdmin}
                  className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs"
                >
                  <input
                    type="text"
                    required
                    placeholder="Resident Full Name"
                    value={newResName}
                    onChange={(e) => setNewResName(e.target.value)}
                    className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Street Address"
                    value={newResAddress}
                    onChange={(e) => setNewResAddress(e.target.value)}
                    className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
                  />
                  <input
                    type="text"
                    required
                    placeholder="Area / Ward"
                    value={newResArea}
                    onChange={(e) => setNewResArea(e.target.value)}
                    className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
                  />
                  <input
                    type="text"
                    required
                    placeholder="City"
                    value={newResCity}
                    onChange={(e) => setNewResCity(e.target.value)}
                    className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
                  />
                  <input
                    type="text"
                    required
                    placeholder="PIN Code"
                    value={newResPin}
                    onChange={(e) => setNewResPin(e.target.value)}
                    className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 font-mono"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      placeholder="Phone"
                      value={newResPhone}
                      onChange={(e) => setNewResPhone(e.target.value)}
                      className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 font-mono"
                    />
                    <button
                      type="submit"
                      disabled={savingResident}
                      className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 shrink-0 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add</span>
                    </button>
                  </div>
                </form>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-4">
                <h2 className="text-base font-bold text-slate-900">
                  Registered Residents ({residents.length})
                </h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2.5 px-3 font-semibold">Resident ID</th>
                        <th className="py-2.5 px-3 font-semibold">Name</th>
                        <th className="py-2.5 px-3 font-semibold">Address</th>
                        <th className="py-2.5 px-3 font-semibold">Area / City</th>
                        <th className="py-2.5 px-3 font-semibold">Phone</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Rewards</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {residents.map((r) => (
                        <tr key={r.residentId} className="hover:bg-slate-50">
                          <td className="py-3 px-3 font-mono font-bold text-slate-900">
                            {r.residentId}
                          </td>
                          <td className="py-3 px-3 font-semibold text-slate-900">
                            {r.name}
                          </td>
                          <td className="py-3 px-3 text-slate-700">{r.address}</td>
                          <td className="py-3 px-3 text-slate-600">
                            {r.area}, {r.city} ({r.pin})
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-600">
                            {r.phone}
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-right text-emerald-700">
                            {r.rewardPoints} pts
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 3. COLLECTORS */}
          {activeNav === 'collectors' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-4">
              <h1 className="text-xl font-bold text-slate-900">
                Registered Garbage Collectors ({collectors.length})
              </h1>
              {collectors.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  No collectors registered yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2.5 px-3 font-semibold">Collector ID</th>
                        <th className="py-2.5 px-3 font-semibold">Name</th>
                        <th className="py-2.5 px-3 font-semibold">Vehicle ID</th>
                        <th className="py-2.5 px-3 font-semibold">Assigned Area</th>
                        <th className="py-2.5 px-3 font-semibold">Phone</th>
                        <th className="py-2.5 px-3 font-semibold">Last GPS</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {collectors.map((col) => (
                        <tr key={col.collectorId} className="hover:bg-slate-50">
                          <td className="py-3 px-3 font-mono font-bold text-slate-900">
                            {col.collectorId}
                          </td>
                          <td className="py-3 px-3 font-semibold text-slate-900">
                            {col.name}
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-700">
                            {col.vehicleId}
                          </td>
                          <td className="py-3 px-3 text-slate-700">
                            {col.assignedArea}
                          </td>
                          <td className="py-3 px-3 font-mono text-slate-600">
                            {col.phone}
                          </td>
                          <td className="py-3 px-3 font-mono text-emerald-700">
                            {col.latitude !== undefined && col.longitude !== undefined
                              ? `${col.latitude}, ${col.longitude}`
                              : 'Awaiting GPS'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 4. VEHICLES */}
          {activeNav === 'vehicles' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-4">
              <h1 className="text-xl font-bold text-slate-900">
                Active Collection Vehicles ({activeVehiclesList.length})
              </h1>
              {activeVehiclesList.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  No active vehicles recorded yet.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {activeVehiclesList.map((v) => (
                    <div
                      key={v.vehicleId}
                      className="p-5 rounded-2xl border border-slate-200 bg-slate-50/70 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-sm text-slate-900">
                          {v.vehicleId}
                        </span>
                        <span className="text-xs font-semibold text-emerald-700">
                          Active
                        </span>
                      </div>
                      <p className="text-xs text-slate-600">
                        Collector: <strong className="text-slate-900">{v.collectorName}</strong>
                      </p>
                      <p className="text-xs text-slate-600">
                        Zone: {v.area} · Pickups: {v.pickups}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 5. COLLECTIONS (FULL VERIFICATION RECORDS WITH IMAGE, GPS, CONFIDENCE) */}
          {activeNav === 'collections' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-900">
                    All Verified Collections ({collections.length})
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Click any row to inspect the full-resolution waste image and GPS coordinates
                  </p>
                </div>

                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search resident, ID, collector..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-3 px-2.5 font-semibold">Waste Image</th>
                      <th className="py-3 px-2.5 font-semibold">Resident</th>
                      <th className="py-3 px-2.5 font-semibold">Address</th>
                      <th className="py-3 px-2.5 font-semibold">Household ID</th>
                      <th className="py-3 px-2.5 font-semibold">Waste Type</th>
                      <th className="py-3 px-2.5 font-semibold text-right">Confidence</th>
                      <th className="py-3 px-2.5 font-semibold">Collector</th>
                      <th className="py-3 px-2.5 font-semibold">Vehicle</th>
                      <th className="py-3 px-2.5 font-semibold">GPS</th>
                      <th className="py-3 px-2.5 font-semibold">Date/Time</th>
                      <th className="py-3 px-2.5 font-semibold text-right">Reward</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {collections
                      .filter((c) => {
                        const q = searchQuery.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          c.residentName.toLowerCase().includes(q) ||
                          c.householdId.toLowerCase().includes(q) ||
                          c.collectorName.toLowerCase().includes(q) ||
                          (c.wasteType || '').toLowerCase().includes(q)
                        );
                      })
                      .map((c) => (
                        <tr
                          key={c.collectionId}
                          onClick={() => setSelectedCollectionDetail(c)}
                          className="hover:bg-slate-50 cursor-pointer"
                        >
                          <td className="py-2.5 px-2.5">
                            {c.imageUrl &&
                            (c.imageUrl.startsWith('http') ||
                              c.imageUrl.startsWith('data:image/')) ? (
                              <img
                                src={c.imageUrl}
                                alt={c.wasteType}
                                referrerPolicy="no-referrer"
                                className="w-12 h-12 rounded-lg object-cover border border-slate-200"
                              />
                            ) : (
                              <span className="text-[10px] font-mono text-slate-400">
                                Stored
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-2.5 font-bold text-slate-900">
                            {c.residentName}
                          </td>
                          <td className="py-2.5 px-2.5 text-slate-600 max-w-[160px] truncate">
                            {c.address}
                          </td>
                          <td className="py-2.5 px-2.5 font-mono text-slate-800">
                            {c.householdId}
                          </td>
                          <td className="py-2.5 px-2.5 font-semibold text-indigo-700">
                            {c.wasteType || WASTE_CATEGORY_LABELS[c.wasteCategory]}
                          </td>
                          <td className="py-2.5 px-2.5 font-mono font-bold text-right text-slate-900">
                            {c.confidence}%
                          </td>
                          <td className="py-2.5 px-2.5 text-slate-700">
                            {c.collectorName}
                          </td>
                          <td className="py-2.5 px-2.5 font-mono text-slate-700">
                            {c.vehicleId || c.vehicleNumber}
                          </td>
                          <td className="py-2.5 px-2.5 font-mono text-slate-600 whitespace-nowrap">
                            {c.latitude}, {c.longitude}
                          </td>
                          <td className="py-2.5 px-2.5 font-mono text-slate-500 whitespace-nowrap">
                            {formatTime(c.timestamp || c.createdAt)}
                          </td>
                          <td className="py-2.5 px-2.5 font-mono font-bold text-right text-emerald-700">
                            +{c.rewardPoints || c.rewardPointsEarned} pts
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6. LIVE GPS */}
          {activeNav === 'live-gps' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-5">
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  Live Field GPS Telemetry
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Real GPS coordinates captured from collectors and verified waste pickups
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {collections.slice(0, 10).map((c) => (
                  <div
                    key={c.collectionId}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <span className="font-bold text-slate-900 block">
                        {c.residentName} ({c.householdId})
                      </span>
                      <span className="text-slate-600 block">
                        Collector: {c.collectorName} · Vehicle: {c.vehicleId || c.vehicleNumber}
                      </span>
                      <span className="font-mono text-emerald-700 font-semibold block">
                        Lat: {c.latitude}, Lng: {c.longitude}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500">
                      {formatTime(c.timestamp || c.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 7. REWARDS */}
          {activeNav === 'rewards' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-4">
              <h1 className="text-xl font-bold text-slate-900">
                Household Reward Balances ({totalRewardsIssued} Total Points)
              </h1>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2.5 px-3 font-semibold">Resident</th>
                      <th className="py-2.5 px-3 font-semibold">Household ID</th>
                      <th className="py-2.5 px-3 font-semibold">Area</th>
                      <th className="py-2.5 px-3 font-semibold text-right">
                        Reward Points
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {residents.map((r) => (
                      <tr key={r.residentId} className="hover:bg-slate-50">
                        <td className="py-3 px-3 font-semibold text-slate-900">
                          {r.name}
                        </td>
                        <td className="py-3 px-3 font-mono text-slate-700">
                          {r.householdId}
                        </td>
                        <td className="py-3 px-3 text-slate-600">{r.area}</td>
                        <td className="py-3 px-3 font-mono font-bold text-right text-emerald-700">
                          {r.rewardPoints} pts
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 8. LEADERBOARD (REAL FIRESTORE DATA + DAILY/MONTHLY/YEARLY/AREA FILTERS) */}
          {activeNav === 'leaderboard' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-900">
                    Municipal Sustainability Leaderboard
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Top 3 residents can be marked &ldquo;Eligible for Admin Review&rdquo; for municipal incentive programs.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(['ALL', 'DAILY', 'MONTHLY', 'YEARLY'] as const).map((period) => (
                    <button
                      key={period}
                      type="button"
                      onClick={() => setLeaderboardPeriod(period)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                        leaderboardPeriod === period
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      {period === 'ALL'
                        ? 'All Time'
                        : period.charAt(0) + period.slice(1).toLowerCase()}
                    </button>
                  ))}

                  <select
                    value={leaderboardArea}
                    onChange={(e) => setLeaderboardArea(e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 border border-slate-200 text-slate-700"
                  >
                    <option value="ALL">All Areas</option>
                    {uniqueAreas.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-3 px-3 font-semibold">Rank</th>
                      <th className="py-3 px-3 font-semibold">Resident</th>
                      <th className="py-3 px-3 font-semibold">Area</th>
                      <th className="py-3 px-3 font-semibold text-right">
                        Verified Collections
                      </th>
                      <th className="py-3 px-3 font-semibold text-right">
                        Reward Points
                      </th>
                      <th className="py-3 px-3 font-semibold text-right">
                        Admin Review Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leaderboardList.map((r, idx) => {
                      const rank = idx + 1;
                      const isEligible = rank <= 3 || Boolean(r.eligibleForAdminReview);
                      return (
                        <tr key={r.residentId} className="hover:bg-slate-50">
                          <td className="py-3 px-3 font-mono font-bold text-slate-900">
                            #{rank}
                          </td>
                          <td className="py-3 px-3">
                            <span className="font-bold text-slate-900 block">
                              {r.name}
                            </span>
                            <span className="font-mono text-[11px] text-slate-500">
                              {r.householdId}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-slate-600">{r.area}</td>
                          <td className="py-3 px-3 font-mono text-right text-slate-800">
                            {r.displayCollections}
                          </td>
                          <td className="py-3 px-3 font-mono font-bold text-right text-emerald-700">
                            {r.displayPoints} pts
                          </td>
                          <td className="py-3 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => handleToggleAdminReviewEligibility(r)}
                              className={`px-3 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${
                                isEligible
                                  ? 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {isEligible
                                ? 'Eligible for Admin Review'
                                : 'Mark Eligible for Review'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 9. GOVERNMENT INCENTIVES WORKFLOW */}
          {activeNav === 'incentives' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-900">
                    Create Government Incentive Program
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Admin-managed municipal incentive workflow. Top leaderboard residents are marked &ldquo;Eligible for Admin Review&rdquo; (subject to municipal verification).
                  </p>
                </div>

                <form
                  onSubmit={handleCreateGovernmentIncentive}
                  className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs"
                >
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Program Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., Clean Ward Property Tax Rebate"
                      value={programName}
                      onChange={(e) => setProgramName(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Eligibility Criteria
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., Top 3 Leaderboard · Min 200 Verified Points"
                      value={eligibility}
                      onChange={(e) => setEligibility(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Reward / Subsidy Amount
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., 5% Municipal Utility Rebate"
                      value={rewardAmount}
                      onChange={(e) => setRewardAmount(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Status
                    </label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as any)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
                    >
                      <option value="ACTIVE">ACTIVE</option>
                      <option value="UPCOMING">UPCOMING</option>
                      <option value="PAUSED">PAUSED</option>
                      <option value="CLOSED">CLOSED</option>
                    </select>
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      required
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      required
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Supporting Documents Required
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., Household ID Pass & Verified Collection Logs"
                      value={supportingDocuments}
                      onChange={(e) => setSupportingDocuments(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Admin Review Notes
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., Subject to municipal verification audit"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
                    />
                  </div>

                  <div className="sm:col-span-2 flex items-center justify-between pt-2">
                    {incentiveNotice ? (
                      <span className="text-xs font-semibold text-emerald-700">
                        {incentiveNotice}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500">
                        All programs require formal Admin Review of verified Firestore logs.
                      </span>
                    )}
                    <button
                      type="submit"
                      disabled={savingIncentive}
                      className="min-h-[42px] px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs cursor-pointer"
                    >
                      {savingIncentive ? 'Saving...' : 'Create Incentive Program'}
                    </button>
                  </div>
                </form>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-4">
                <h2 className="text-base font-bold text-slate-900">
                  Configured Incentive Programs ({incentives.length})
                </h2>
                {incentives.length === 0 ? (
                  <p className="py-8 text-center text-xs text-slate-500">
                    No incentive programs created yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {incentives.map((inc) => (
                      <div
                        key={inc.incentiveId}
                        className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-slate-900">
                            {inc.programName}
                          </span>
                          <span className="font-mono font-bold text-emerald-700">
                            {inc.status} · {inc.rewardAmount}
                          </span>
                        </div>
                        <p className="text-slate-700">
                          <strong>Eligibility:</strong> {inc.eligibility}
                        </p>
                        <p className="text-slate-600">
                          <strong>Dates:</strong> {inc.startDate} to {inc.endDate} ·{' '}
                          <strong>Docs:</strong> {inc.supportingDocuments}
                        </p>
                        <p className="text-slate-500">{inc.notes}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 10. REPORTS */}
          {activeNav === 'reports' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-5">
              <h1 className="text-xl font-bold text-slate-900">
                AI Waste Category Distribution Report
              </h1>
              {categoryBreakdown.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  No verified waste data available yet.
                </p>
              ) : (
                <div className="space-y-3">
                  {categoryBreakdown.map(([label, count]) => {
                    const pct = Math.round(
                      (count / Math.max(1, collections.length)) * 100
                    );
                    return (
                      <div key={label} className="space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="font-semibold text-slate-800">{label}</span>
                          <span className="font-mono text-slate-600">
                            {count} pickups ({pct}%)
                          </span>
                        </div>
                        <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full bg-emerald-600 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 11. SETTINGS */}
          {activeNav === 'settings' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-4 max-w-xl text-xs">
              <h1 className="text-xl font-bold text-slate-900">
                System &amp; Capacitor API Configuration
              </h1>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Admin Account:</span>
                  <span className="font-semibold text-slate-900">{user.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Configured Backend URL:</span>
                  <span className="font-mono text-slate-800">
                    {String((import.meta as any).env?.VITE_API_BASE_URL || 'Same-Origin /api')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Android Package ID:</span>
                  <span className="font-mono text-slate-800">com.ecoverify.portal</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Collection Detail Modal for Admin */}
      {selectedCollectionDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span className="text-sm font-bold">
                  Verified Collection Record
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCollectionDetail(null)}
                className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {selectedCollectionDetail.imageUrl &&
                (selectedCollectionDetail.imageUrl.startsWith('http') ||
                  selectedCollectionDetail.imageUrl.startsWith('data:image/')) && (
                  <div className="rounded-xl overflow-hidden bg-slate-950 aspect-video border border-slate-200">
                    <img
                      src={selectedCollectionDetail.imageUrl}
                      alt="Captured garbage"
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-contain"
                    />
                  </div>
                )}

              <dl className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <dt className="text-slate-500">Resident</dt>
                  <dd className="font-bold text-slate-900 mt-0.5">
                    {selectedCollectionDetail.residentName}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Household ID</dt>
                  <dd className="font-mono font-bold text-slate-900 mt-0.5">
                    {selectedCollectionDetail.householdId}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-slate-500">Address</dt>
                  <dd className="text-slate-800 mt-0.5">
                    {selectedCollectionDetail.address}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Waste Type</dt>
                  <dd className="font-bold text-indigo-700 mt-0.5">
                    {selectedCollectionDetail.wasteType ||
                      WASTE_CATEGORY_LABELS[selectedCollectionDetail.wasteCategory]}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Confidence</dt>
                  <dd className="font-mono font-bold text-slate-900 mt-0.5">
                    {selectedCollectionDetail.confidence}%
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Collector</dt>
                  <dd className="font-semibold text-slate-900 mt-0.5">
                    {selectedCollectionDetail.collectorName}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Vehicle</dt>
                  <dd className="font-mono text-slate-900 mt-0.5">
                    {selectedCollectionDetail.vehicleId ||
                      selectedCollectionDetail.vehicleNumber}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">GPS Coordinates</dt>
                  <dd className="font-mono text-emerald-700 mt-0.5">
                    {selectedCollectionDetail.latitude},{' '}
                    {selectedCollectionDetail.longitude}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Reward Points</dt>
                  <dd className="font-mono font-bold text-emerald-700 mt-0.5">
                    +{selectedCollectionDetail.rewardPoints ||
                      selectedCollectionDetail.rewardPointsEarned}{' '}
                    pts
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
