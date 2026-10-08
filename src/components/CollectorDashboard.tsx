import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { User } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  CollectorRecord,
  GarbageCollectionRecord,
  SelectedResident,
  WASTE_CATEGORY_LABELS,
} from '../types';
import { ResidentQRScannerModal } from './ResidentQRScannerModal';
import { GarbageScannerModal } from './GarbageScannerModal';
import {
  Home,
  QrCode,
  Camera,
  ClipboardList,
  Truck,
  UserCheck,
  LogOut,
  ShieldCheck,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Menu,
  X,
  RefreshCw,
} from 'lucide-react';

type CollectorNavTab =
  | 'dashboard'
  | 'scan-resident'
  | 'waste-inspection'
  | 'history'
  | 'gps-vehicle'
  | 'profile';

interface CollectorDashboardProps {
  user: User;
  collectorProfile: CollectorRecord;
  collections: GarbageCollectionRecord[];
  onSignOut: () => void;
}

export const CollectorDashboard: React.FC<CollectorDashboardProps> = ({
  user,
  collectorProfile,
  collections,
  onSignOut,
}) => {
  const [activeNav, setActiveNav] = useState<CollectorNavTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [selectedResident, setSelectedResident] = useState<SelectedResident | null>(null);
  const [vehicleId, setVehicleId] = useState<string>(collectorProfile.vehicleId || 'DL-1GC-4092');

  // Real Device GPS state
  const [gpsState, setGpsState] = useState<'ACTIVE' | 'PERMISSION_REQUIRED'>('PERMISSION_REQUIRED');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);

  // Profile Edit State
  const [editName, setEditName] = useState(collectorProfile.name);
  const [editVehicle, setEditVehicle] = useState(collectorProfile.vehicleId);
  const [editArea, setEditArea] = useState(collectorProfile.assignedArea);
  const [editPhone, setEditPhone] = useState(collectorProfile.phone);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);

  const acquireRealGps = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setGpsState('PERMISSION_REQUIRED');
      setCoords(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        setCoords({ latitude: lat, longitude: lng });
        setGpsState('ACTIVE');

        try {
          await updateDoc(doc(db, 'collectors', collectorProfile.collectorId), {
            latitude: lat,
            longitude: lng,
            gpsActive: true,
          });
        } catch {
          // Ignore background telemetry update error
        }
      },
      () => {
        setGpsState('PERMISSION_REQUIRED');
        setCoords(null);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  }, [collectorProfile.collectorId]);

  useEffect(() => {
    acquireRealGps();
  }, [acquireRealGps]);

  const myCollections = useMemo(() => {
    return collections.filter(
      (c) =>
        c.collectorUid === user.uid ||
        c.collectorId === collectorProfile.collectorId
    );
  }, [collections, user.uid, collectorProfile.collectorId]);

  const todaysVerifiedCollections = useMemo(() => {
    const now = new Date();
    return myCollections.filter((c) => {
      const sec = c.timestamp?.seconds || c.createdAt?.seconds;
      if (!sec) return true;
      const d = new Date(sec * 1000);
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    });
  }, [myCollections]);

  const todaysRewardsGenerated = useMemo(() => {
    return todaysVerifiedCollections.reduce(
      (sum, item) => sum + Number(item.rewardPoints || item.rewardPointsEarned || 0),
      0
    );
  }, [todaysVerifiedCollections]);

  const handleSaveCollectorProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileNotice(null);
    try {
      const cleanName = editName.trim().slice(0, 120);
      const cleanVeh = editVehicle.trim().slice(0, 60);
      const cleanArea = editArea.trim().slice(0, 120);
      const cleanPhone = editPhone.trim().slice(0, 30);

      await updateDoc(doc(db, 'collectors', collectorProfile.collectorId), {
        name: cleanName,
        vehicleId: cleanVeh,
        assignedArea: cleanArea,
        phone: cleanPhone,
      });
      setVehicleId(cleanVeh);
      setProfileNotice('Collector profile updated in Firestore.');
    } catch (err) {
      try {
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `collectors/${collectorProfile.collectorId}`
        );
      } catch (e2: any) {
        setProfileNotice(`Error: ${e2.message}`);
      }
    } finally {
      setSavingProfile(false);
    }
  };

  const formatTime = (ts: any) => {
    const sec = ts?.seconds;
    if (!sec) return 'Just now';
    return new Date(sec * 1000).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const navItems: { id: CollectorNavTab; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <Home className="w-4 h-4" /> },
    { id: 'scan-resident', label: 'Scan Resident', icon: <QrCode className="w-4 h-4" /> },
    {
      id: 'waste-inspection',
      label: 'Waste Inspection',
      icon: <Camera className="w-4 h-4" />,
    },
    {
      id: 'history',
      label: 'Collection History',
      icon: <ClipboardList className="w-4 h-4" />,
    },
    {
      id: 'gps-vehicle',
      label: 'GPS/Vehicle Status',
      icon: <Truck className="w-4 h-4" />,
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
              Collector Portal
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
              {collectorProfile.name}
            </p>
            <p className="text-[11px] font-mono text-slate-500 truncate">
              {collectorProfile.collectorId} · {vehicleId}
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
              EcoVerify Collector
            </span>
            <span className="text-[10px] font-mono text-emerald-700 block">
              {collectorProfile.collectorId}
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

      {/* Main Content */}
      <main className="flex-1 md:pl-64 pb-20 md:pb-8">
        <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
          {/* 1. COLLECTOR DASHBOARD */}
          {activeNav === 'dashboard' && (
            <div className="space-y-6">
              {/* Collector Info Banner */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <span className="text-xs font-bold text-emerald-700 uppercase">
                      Municipal Field Collector
                    </span>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-0.5">
                      {collectorProfile.name}
                    </h1>
                    <p className="text-xs text-slate-500 font-mono mt-0.5">
                      Collector ID: {collectorProfile.collectorId}
                    </p>
                  </div>

                  <div>
                    {gpsState === 'ACTIVE' && coords ? (
                      <span className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        <span>
                          GPS Active ({coords.latitude.toFixed(4)}, {coords.longitude.toFixed(4)})
                        </span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={acquireRealGps}
                        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold cursor-pointer"
                      >
                        <AlertCircle className="w-4 h-4 text-amber-600" />
                        <span>GPS Permission Required (Tap to Enable)</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Collector Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs text-slate-500 block">Assigned Vehicle</span>
                    <span className="text-sm font-mono font-bold text-slate-900 mt-1 block">
                      {vehicleId}
                    </span>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                    <span className="text-xs text-slate-500 block">Assigned Area</span>
                    <span className="text-sm font-bold text-slate-900 mt-1 block">
                      {collectorProfile.assignedArea}
                    </span>
                  </div>
                  <div className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200">
                    <span className="text-xs text-emerald-800 font-medium block">
                      Today&apos;s Verified Collections
                    </span>
                    <span className="text-2xl font-mono font-bold text-emerald-950 tabular-nums mt-1 block">
                      {todaysVerifiedCollections.length}
                    </span>
                  </div>
                  <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-200">
                    <span className="text-xs text-indigo-800 font-medium block">
                      Today&apos;s Rewards Generated
                    </span>
                    <span className="text-2xl font-mono font-bold text-indigo-950 tabular-nums mt-1 block">
                      +{todaysRewardsGenerated} pts
                    </span>
                  </div>
                </div>

                {/* Primary Field Actions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <button
                    type="button"
                    onClick={() => setActiveNav('scan-resident')}
                    className="min-h-[54px] px-5 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-sm transition-colors cursor-pointer"
                  >
                    <QrCode className="w-5 h-5" />
                    <span>1. Scan Resident QR</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveNav('waste-inspection')}
                    className="min-h-[54px] px-5 py-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-sm transition-colors cursor-pointer"
                  >
                    <Camera className="w-5 h-5" />
                    <span>2. Open Waste Inspection Camera</span>
                  </button>
                </div>
              </div>

              {/* Active Verified Resident Banner */}
              {selectedResident && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-xs font-bold text-emerald-800 uppercase">
                      Active Verified Resident
                    </span>
                    <h2 className="text-base font-bold text-slate-900">
                      {selectedResident.name} ({selectedResident.householdId})
                    </h2>
                    <p className="text-xs text-slate-700">
                      {selectedResident.address}, {selectedResident.area}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveNav('waste-inspection')}
                    className="min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer shrink-0"
                  >
                    Continue to Waste Inspection →
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 2. SCAN RESIDENT (REAL REAR CAMERA QR SCANNER) */}
          {activeNav === 'scan-resident' && (
            <ResidentQRScannerModal
              isOpen={true}
              inlineMode={true}
              onClose={() => setActiveNav('dashboard')}
              onResidentVerified={(res) => setSelectedResident(res)}
              onStartGarbageCollection={(res) => {
                setSelectedResident(res);
                setActiveNav('waste-inspection');
              }}
            />
          )}

          {/* 3. WASTE INSPECTION (REAL CAMERA + GEMINI AI) */}
          {activeNav === 'waste-inspection' && (
            <GarbageScannerModal
              isOpen={true}
              inlineMode={true}
              onClose={() => setActiveNav('dashboard')}
              selectedResident={selectedResident}
              collectorId={collectorProfile.collectorId}
              collectorName={collectorProfile.name}
              vehicleNumber={vehicleId}
              onVehicleNumberChange={setVehicleId}
              onCollectionSubmitted={() => {}}
              onRequestQRScan={() => setActiveNav('scan-resident')}
            />
          )}

          {/* 4. COLLECTION HISTORY */}
          {activeNav === 'history' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-2xs space-y-4">
              <div>
                <h1 className="text-xl font-bold text-slate-900">
                  Collector Pickup History
                </h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Verified collections recorded by {collectorProfile.name} ({collectorProfile.collectorId})
                </p>
              </div>

              {myCollections.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No verified collections submitted yet.
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
                              {c.residentName}
                            </span>
                            <span className="text-xs font-mono text-slate-500">
                              ({c.householdId})
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-indigo-700">
                            Waste: {c.wasteType || WASTE_CATEGORY_LABELS[c.wasteCategory]} ·{' '}
                            {c.confidence}% confidence
                          </p>
                          <p className="text-[11px] font-mono text-slate-500">
                            GPS: {c.latitude}, {c.longitude} · {formatTime(c.timestamp || c.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex sm:flex-col items-end justify-between w-full sm:w-auto border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-200/70">
                        <span className="text-xs font-mono font-bold text-emerald-700">
                          +{c.rewardPoints || c.rewardPointsEarned} pts
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

          {/* 5. GPS / VEHICLE STATUS */}
          {activeNav === 'gps-vehicle' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs space-y-5">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-bold text-slate-900">
                    GPS &amp; Vehicle Status
                  </h1>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Real device location telemetry and assigned municipal vehicle
                  </p>
                </div>
                <button
                  type="button"
                  onClick={acquireRealGps}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh GPS</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-slate-500">GPS Status</span>
                  <p className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-emerald-600" />
                    <span>
                      {gpsState === 'ACTIVE' ? 'GPS Active' : 'GPS Permission Required'}
                    </span>
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-slate-500">Coordinates (Lat, Lng)</span>
                  <p className="text-sm font-mono font-bold text-slate-900 tabular-nums">
                    {coords ? `${coords.latitude}, ${coords.longitude}` : 'Not acquired'}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-slate-500">Assigned Vehicle ID</span>
                  <p className="text-sm font-mono font-bold text-slate-900">
                    {vehicleId}
                  </p>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-slate-500">Assigned Collection Area</span>
                  <p className="text-sm font-bold text-slate-900">
                    {collectorProfile.assignedArea}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 6. COLLECTOR PROFILE */}
          {activeNav === 'profile' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xs max-w-xl space-y-5">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Collector Profile</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                  Update your assigned vehicle and area in Firestore
                </p>
              </div>

              <form onSubmit={handleSaveCollectorProfile} className="space-y-4 text-xs">
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Collector ID
                  </label>
                  <input
                    type="text"
                    disabled
                    value={collectorProfile.collectorId}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 border border-slate-200 font-mono text-slate-600"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 block mb-1">
                    Collector Name
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Assigned Vehicle ID
                    </label>
                    <input
                      type="text"
                      required
                      value={editVehicle}
                      onChange={(e) => setEditVehicle(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 font-mono text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="font-semibold text-slate-700 block mb-1">
                      Assigned Area
                    </label>
                    <input
                      type="text"
                      required
                      value={editArea}
                      onChange={(e) => setEditArea(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900"
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
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 font-mono text-slate-900"
                  />
                </div>

                {profileNotice && (
                  <p className="text-xs font-semibold text-emerald-700">
                    {profileNotice}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={savingProfile}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer"
                >
                  {savingProfile ? 'Saving...' : 'Save Collector Profile'}
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
          { id: 'scan-resident', label: 'Scan QR', icon: <QrCode className="w-4 h-4" /> },
          { id: 'waste-inspection', label: 'Inspect', icon: <Camera className="w-4 h-4" /> },
          { id: 'history', label: 'History', icon: <ClipboardList className="w-4 h-4" /> },
          { id: 'gps-vehicle', label: 'GPS', icon: <Truck className="w-4 h-4" /> },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveNav(item.id as CollectorNavTab)}
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
