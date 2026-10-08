import React, { useState, useMemo, useRef } from 'react';
import { User } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { QRCodeCanvas } from 'qrcode.react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  GarbageCollectionRecord,
  ResidentRecord,
  WASTE_CATEGORY_LABELS,
} from '../types';
import {
  Home,
  QrCode,
  ClipboardList,
  Award,
  Trophy,
  Leaf,
  UserCheck,
  LogOut,
  CheckCircle2,
  Download,
  MapPin,
  ShieldCheck,
  Menu,
  X,
} from 'lucide-react';

type ResidentNavTab =
  | 'dashboard'
  | 'my-qr'
  | 'history'
  | 'rewards'
  | 'leaderboard'
  | 'tips'
  | 'profile';

interface ResidentDashboardProps {
  user: User;
  residentProfile: ResidentRecord;
  allResidents: ResidentRecord[];
  allCollections: GarbageCollectionRecord[];
  onSignOut: () => void;
}

export const ResidentDashboard: React.FC<ResidentDashboardProps> = ({
  user,
  residentProfile,
  allResidents,
  allCollections,
  onSignOut,
}) => {
  const [activeNav, setActiveNav] = useState<ResidentNavTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Leaderboard filters: Daily, Monthly, Yearly, Area
  const [leaderboardPeriod, setLeaderboardPeriod] = useState<'ALL' | 'DAILY' | 'MONTHLY' | 'YEARLY'>('ALL');
  const [leaderboardArea, setLeaderboardArea] = useState<string>('ALL');

  // Profile edit state
  const [editName, setEditName] = useState(residentProfile.name);
  const [editAddress, setEditAddress] = useState(residentProfile.address);
  const [editArea, setEditArea] = useState(residentProfile.area);
  const [editCity, setEditCity] = useState(residentProfile.city);
  const [editPin, setEditPin] = useState(residentProfile.pin);
  const [editPhone, setEditPhone] = useState(residentProfile.phone);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  const qrContainerRef = useRef<HTMLDivElement | null>(null);

  // Collections belonging to this resident
  const myCollections = useMemo(() => {
    return allCollections.filter(
      (c) =>
        c.residentId === residentProfile.residentId ||
        c.householdId === residentProfile.householdId
    );
  }, [allCollections, residentProfile.residentId, residentProfile.householdId]);

  const totalRewardPoints = useMemo(() => {
    const fromCollections = myCollections.reduce(
      (sum, c) => sum + Number(c.rewardPoints || c.rewardPointsEarned || 0),
      0
    );
    return Math.max(Number(residentProfile.rewardPoints || 0), fromCollections);
  }, [myCollections, residentProfile.rewardPoints]);

  const uniqueAreas = useMemo(() => {
    const s = new Set<string>();
    allResidents.forEach((r) => {
      if (r.area) s.add(r.area);
    });
    return Array.from(s);
  }, [allResidents]);

  // Real Firestore Leaderboard with Daily / Monthly / Yearly / Area filters
  const leaderboardEntries = useMemo(() => {
    const now = new Date();
    return allResidents
      .filter((r) => leaderboardArea === 'ALL' || r.area === leaderboardArea)
      .map((r) => {
        const resCols = allCollections.filter((c) => {
          const matchesResident =
            c.residentId === r.residentId || c.householdId === r.householdId;
          if (!matchesResident) return false;

          const tsSec = c.timestamp?.seconds || c.createdAt?.seconds;
          if (!tsSec || leaderboardPeriod === 'ALL') return true;
          const d = new Date(tsSec * 1000);
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
          (sum, item) => sum + Number(item.rewardPoints || item.rewardPointsEarned || 0),
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
  }, [allResidents, allCollections, leaderboardPeriod, leaderboardArea]);

  const myRank = useMemo(() => {
    const idx = leaderboardEntries.findIndex(
      (item) => item.residentId === residentProfile.residentId
    );
    return idx >= 0 ? idx + 1 : 1;
  }, [leaderboardEntries, residentProfile.residentId]);

  const handleDownloadQR = () => {
    const canvas = qrContainerRef.current?.querySelector('canvas');
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `EcoVerify-QR-${residentProfile.residentId}.png`;
    a.click();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const cleanName = editName.trim().slice(0, 120);
      const cleanAddress = editAddress.trim().slice(0, 250);
      const cleanArea = editArea.trim().slice(0, 120);
      const cleanCity = editCity.trim().slice(0, 100);
      const cleanPin = editPin.trim().slice(0, 20);
      const cleanPhone = editPhone.trim().slice(0, 30);

      await updateDoc(doc(db, 'residents', residentProfile.residentId), {
        name: cleanName,
        address: cleanAddress,
        area: cleanArea,
        city: cleanCity,
        pin: cleanPin,
        phone: cleanPhone,
      });

      try {
        await updateDoc(doc(db, 'households', residentProfile.householdId), {
          name: cleanName,
          address: cleanAddress,
          area: cleanArea,
          city: cleanCity,
          pinCode: cleanPin,
          phone: cleanPhone,
        });
      } catch {
        // Ignore if household doc not separate
      }

      setProfileMessage('Profile updated in Firestore.');
    } catch (err) {
      try {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `residents/${residentProfile.residentId}`
        );
      } catch (e2: any) {
        setProfileMessage(`Error: ${e2.message}`);
      }
    } finally {
      setProfileSaving(false);
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

  const navItems: { id: ResidentNavTab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <Home className="w-4 h-4" /> },
    { id: 'my-qr', label: 'My QR', icon: <QrCode className="w-4 h-4" /> },
    {
      id: 'history',
      label: 'Collection History',
      icon: <ClipboardList className="w-4 h-4" />,
    },
    { id: 'rewards', label: 'Rewards', icon: <Award className="w-4 h-4" /> },
    { id: 'leaderboard', label: 'Leaderboard', icon: <Trophy className="w-4 h-4" /> },
    {
      id: 'tips',
      label: 'Sustainability Tips',
      icon: <Leaf className="w-4 h-4" />,
    },
    { id: 'profile', label: 'Profile', icon: <UserCheck className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col md:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="p-5 border-b border-slate-100 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="text-base font-bold text-slate-900 block leading-none">
              EcoVerify
            </span>
            <span className="text-[11px] font-semibold text-emerald-700 mt-1 block">
              Resident Portal
            </span>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveNav(item.id)}
              className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-3 transition-colors cursor-pointer ${
                activeNav === item.id
                  ? 'bg-emerald-600 text-white shadow-xs'
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
              {residentProfile.name}
            </p>
            <p className="text-[11px] font-mono text-slate-500 truncate">
              {residentProfile.householdId}
            </p>
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
          <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <span className="text-sm font-bold text-slate-900 block leading-none">
              EcoVerify
            </span>
            <span className="text-[10px] font-semibold text-emerald-700 block">
              Resident · {residentProfile.householdId}
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
        <div className="md:hidden bg-white border-b border-slate-200 px-4 py-3 space-y-1 z-30">
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
                  ? 'bg-emerald-600 text-white'
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

      {/* Main Viewport */}
      <main className="flex-1 md:pl-64 pb-20 md:pb-8">
        <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
          {/* 1. RESIDENT DASHBOARD */}
          {activeNav === 'dashboard' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-emerald-700">
                    Verified Resident Account
                  </span>
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                    {residentProfile.name}
                  </h1>
                  <p className="text-xs text-slate-600 flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    <span>
                      {residentProfile.address}, {residentProfile.area}, {residentProfile.city} ({residentProfile.pin})
                    </span>
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="px-3.5 py-2 rounded-xl bg-slate-100 border border-slate-200 text-xs">
                    <span className="text-slate-500 block text-[10px]">Household ID</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {residentProfile.householdId}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveNav('my-qr')}
                    className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
                  >
                    <QrCode className="w-4 h-4" />
                    <span>Show My QR</span>
                  </button>
                </div>
              </div>

              {/* Resident KPI Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <span className="text-xs font-semibold text-slate-500">
                    Total Verified Collections
                  </span>
                  <p className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 tabular-nums mt-2">
                    {myCollections.length}
                  </p>
                  <p className="text-xs text-emerald-700 font-medium mt-1">
                    AI-verified pickups
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <span className="text-xs font-semibold text-slate-500">
                    Reward Points
                  </span>
                  <p className="text-2xl sm:text-3xl font-bold font-mono text-emerald-700 tabular-nums mt-2">
                    {totalRewardPoints}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Green verification balance
                  </p>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs">
                  <span className="text-xs font-semibold text-slate-500">
                    Current Leaderboard Position
                  </span>
                  <p className="text-2xl sm:text-3xl font-bold font-mono text-slate-900 tabular-nums mt-2">
                    #{myRank}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {myRank <= 3 ? 'Eligible for Admin Review' : `In ${residentProfile.area}`}
                  </p>
                </div>
              </div>

              {/* Recent Collection History */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-900">
                    Recent Collection History
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveNav('history')}
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 cursor-pointer"
                  >
                    View All →
                  </button>
                </div>

                {myCollections.length === 0 ? (
                  <div className="py-10 text-center space-y-2">
                    <p className="text-sm font-semibold text-slate-800">
                      No verified collections yet
                    </p>
                    <p className="text-xs text-slate-500 max-w-xs mx-auto">
                      Show your Resident QR code in the &ldquo;My QR&rdquo; tab when the municipal collector arrives.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {myCollections.slice(0, 5).map((col) => (
                      <div
                        key={col.collectionId}
                        className="p-4 rounded-xl border border-slate-200/90 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-900">
                              {col.wasteType ||
                                WASTE_CATEGORY_LABELS[col.wasteCategory] ||
                                col.wasteCategory}
                            </span>
                            <span className="text-slate-300">·</span>
                            <span className="text-xs font-mono text-slate-600 tabular-nums">
                              {col.confidence}% confidence
                            </span>
                          </div>
                          <p className="text-xs text-slate-500">
                            Collector: {col.collectorName} · Vehicle: {col.vehicleId || col.vehicleNumber}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">
                            {formatTime(col.timestamp || col.createdAt)}
                          </p>
                        </div>

                        <div className="flex items-center gap-3 self-start sm:self-center">
                          <span className="text-xs font-mono font-bold text-emerald-700 tabular-nums">
                            +{col.rewardPoints || col.rewardPointsEarned} pts
                          </span>
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Verified</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2. MY QR (REAL QR CODE CONTAINING ONLY RESIDENT'S UNIQUE ID) */}
          {activeNav === 'my-qr' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-2xs max-w-lg mx-auto text-center space-y-6">
              <div className="space-y-1">
                <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
                  Official Household Verification Pass
                </span>
                <h1 className="text-xl font-bold text-slate-900">
                  {residentProfile.name}
                </h1>
                <p className="text-xs text-slate-500">
                  {residentProfile.address}, {residentProfile.area}
                </p>
              </div>

              <div
                ref={qrContainerRef}
                className="p-6 rounded-2xl bg-white border-2 border-emerald-600 inline-flex flex-col items-center justify-center shadow-sm mx-auto"
              >
                {/* Encodes ONLY the resident's unique residentId/householdId */}
                <QRCodeCanvas
                  value={residentProfile.residentId}
                  size={230}
                  level="H"
                  includeMargin={true}
                />
                <span className="mt-2 text-xs font-mono font-bold text-slate-900 tabular-nums">
                  {residentProfile.residentId}
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-left text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Resident ID:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {residentProfile.residentId}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Household ID:</span>
                  <span className="font-mono font-bold text-slate-900">
                    {residentProfile.householdId}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Area / Ward:</span>
                  <span className="font-medium text-slate-900">
                    {residentProfile.area}, {residentProfile.city}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleDownloadQR}
                className="w-full min-h-[46px] px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download QR Pass (PNG)</span>
              </button>
            </div>
          )}

          {/* 3. COLLECTION HISTORY */}
          {activeNav === 'history' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  Collection History
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Complete log of verified waste collections for {residentProfile.householdId}
                </p>
              </div>

              {myCollections.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No verified collections recorded yet.
                </div>
              ) : (
                <div className="space-y-3">
                  {myCollections.map((c) => (
                    <div
                      key={c.collectionId}
                      className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-start gap-3.5">
                        {c.imageUrl &&
                          (c.imageUrl.startsWith('http') ||
                            c.imageUrl.startsWith('data:image/')) && (
                            <img
                              src={c.imageUrl}
                              alt={c.wasteType}
                              referrerPolicy="no-referrer"
                              className="w-16 h-16 rounded-xl object-cover border border-slate-200 shrink-0"
                            />
                          )}
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-slate-900">
                              {c.wasteType ||
                                WASTE_CATEGORY_LABELS[c.wasteCategory] ||
                                c.wasteCategory}
                            </span>
                            <span className="text-xs font-mono text-indigo-700 font-semibold">
                              ({c.confidence}%)
                            </span>
                          </div>
                          <p className="text-xs text-slate-600">
                            Collector: {c.collectorName} · Vehicle: {c.vehicleId || c.vehicleNumber}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">
                            GPS: {c.latitude}, {c.longitude} · {formatTime(c.timestamp || c.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex sm:flex-col items-end justify-between w-full sm:w-auto border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200/70">
                        <span className="text-sm font-mono font-bold text-emerald-700 tabular-nums">
                          +{c.rewardPoints || c.rewardPointsEarned} Points
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Verified</span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 4. REWARDS */}
          {activeNav === 'rewards' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <span className="text-xs font-bold text-emerald-700 uppercase">
                      Household Green Balance
                    </span>
                    <h1 className="text-2xl font-bold text-slate-900 mt-0.5">
                      {totalRewardPoints} Reward Points
                    </h1>
                    <p className="text-xs text-slate-500 mt-1">
                      Earned across {myCollections.length} AI-verified waste pickups
                    </p>
                  </div>
                  {myRank <= 3 && (
                    <div className="px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold">
                      Status: Eligible for Admin Review
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-4">
                <h2 className="text-base font-bold text-slate-900">
                  Points Schedule by Verified Waste Category
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  {[
                    { label: 'E-Waste', pts: 50 },
                    { label: 'Metal / Aluminium', pts: 30 },
                    { label: 'Plastic / Glass', pts: 25 },
                    { label: 'Paper / Cardboard', pts: 20 },
                    { label: 'Organic Waste', pts: 20 },
                    { label: 'Wet / Dry Waste', pts: 15 },
                    { label: 'Polythene / Other', pts: 10 },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80"
                    >
                      <span className="text-slate-600 block">{item.label}</span>
                      <span className="text-sm font-mono font-bold text-emerald-700 mt-1 block">
                        +{item.pts} pts
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 5. LEADERBOARD */}
          {activeNav === 'leaderboard' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-bold text-slate-900">
                    Resident Sustainability Leaderboard
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Live rankings from verified Firestore records. Top 3 households are marked Eligible for Admin Review.
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
                        Review Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leaderboardEntries.map((r, idx) => {
                      const rank = idx + 1;
                      const isTop3 = rank <= 3 && r.displayPoints > 0;
                      return (
                        <tr
                          key={r.residentId}
                          className={
                            r.residentId === residentProfile.residentId
                              ? 'bg-emerald-50/70'
                              : 'hover:bg-slate-50'
                          }
                        >
                          <td className="py-3.5 px-3 font-mono font-bold text-slate-900 tabular-nums">
                            #{rank}
                          </td>
                          <td className="py-3.5 px-3">
                            <span className="font-bold text-slate-900 block">
                              {r.name}
                            </span>
                            <span className="font-mono text-[11px] text-slate-500">
                              {r.householdId}
                            </span>
                          </td>
                          <td className="py-3.5 px-3 text-slate-600">{r.area}</td>
                          <td className="py-3.5 px-3 font-mono text-right text-slate-800 tabular-nums">
                            {r.displayCollections}
                          </td>
                          <td className="py-3.5 px-3 font-mono font-bold text-right text-emerald-700 tabular-nums">
                            {r.displayPoints} pts
                          </td>
                          <td className="py-3.5 px-3 text-right">
                            {isTop3 || r.eligibleForAdminReview ? (
                              <span className="text-[11px] font-semibold text-amber-800">
                                Eligible for Admin Review
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400">Standard</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6. SUSTAINABILITY TIPS */}
          {activeNav === 'tips' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-5">
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  Source Segregation &amp; Sustainability Guide
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Follow these guidelines to maximize your household verification score and reward points.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-1.5">
                  <h3 className="font-bold text-emerald-950 text-sm">
                    1. Wet &amp; Organic Waste
                  </h3>
                  <p className="text-emerald-900 leading-relaxed">
                    Keep kitchen food scraps, vegetable peels, and garden leaves separate from plastic liners so they can be composted directly.
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                  <h3 className="font-bold text-slate-900 text-sm">
                    2. Dry Recyclables (Plastic, Paper, Cardboard, Metal, Glass)
                  </h3>
                  <p className="text-slate-700 leading-relaxed">
                    Rinse containers before disposal so the collector&apos;s AI camera can clearly verify recyclable materials with high confidence.
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200 space-y-1.5">
                  <h3 className="font-bold text-indigo-950 text-sm">
                    3. E-Waste &amp; Batteries (+50 Points)
                  </h3>
                  <p className="text-indigo-900 leading-relaxed">
                    Never mix batteries, chargers, or circuit boards with household wet waste. Hand them over separately for high-value verification.
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-200 space-y-1.5">
                  <h3 className="font-bold text-amber-950 text-sm">
                    4. Clear QR Presentation
                  </h3>
                  <p className="text-amber-900 leading-relaxed">
                    Keep your digital or printed Household QR pass ready at pickup time so every collection is credited to your household ID.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 7. PROFILE */}
          {activeNav === 'profile' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs max-w-xl space-y-5">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Resident Profile</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Manage your registered household details in Firestore
                </p>
              </div>

              <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Resident ID (Immutable)
                    </label>
                    <input
                      type="text"
                      disabled
                      value={residentProfile.residentId}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 border border-slate-200 font-mono text-slate-600"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Account Email
                    </label>
                    <input
                      type="text"
                      disabled
                      value={user.email || ''}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-600"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900"
                  />
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Street Address
                  </label>
                  <input
                    type="text"
                    required
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Area / Ward
                    </label>
                    <input
                      type="text"
                      required
                      value={editArea}
                      onChange={(e) => setEditArea(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      City
                    </label>
                    <input
                      type="text"
                      required
                      value={editCity}
                      onChange={(e) => setEditCity(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      PIN Code
                    </label>
                    <input
                      type="text"
                      required
                      value={editPin}
                      onChange={(e) => setEditPin(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    required
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-mono"
                  />
                </div>

                {profileMessage && (
                  <p className="text-xs font-semibold text-emerald-700">
                    {profileMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={profileSaving}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
                >
                  {profileSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </form>
            </div>
          )}
        </div>
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 flex items-center justify-around py-1.5 z-30">
        {[
          { id: 'dashboard', label: 'Home', icon: <Home className="w-4 h-4" /> },
          { id: 'my-qr', label: 'My QR', icon: <QrCode className="w-4 h-4" /> },
          { id: 'history', label: 'History', icon: <ClipboardList className="w-4 h-4" /> },
          { id: 'leaderboard', label: 'Rank', icon: <Trophy className="w-4 h-4" /> },
          { id: 'profile', label: 'Profile', icon: <UserCheck className="w-4 h-4" /> },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveNav(item.id as ResidentNavTab)}
            className={`flex flex-col items-center justify-center px-2 py-1 text-[10px] font-semibold ${
              activeNav === item.id ? 'text-emerald-700' : 'text-slate-500'
            }`}
          >
            {item.icon}
            <span className="mt-0.5">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};
