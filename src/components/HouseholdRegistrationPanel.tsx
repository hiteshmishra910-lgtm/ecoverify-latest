import React, { useState, useRef, useMemo } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { GarbageCollectionRecord, SelectedResident } from '../types';
import {
  Download,
  PlusCircle,
  QrCode,
  CheckCircle2,
  Search,
  MapPin,
  Home,
  X,
  ShieldCheck,
  Award,
  Clock,
} from 'lucide-react';

interface HouseholdRegistrationPanelProps {
  households: SelectedResident[];
  collections: GarbageCollectionRecord[];
  onHouseholdCreated: (resident: SelectedResident) => void;
  onSelectHouseholdForCollection: (resident: SelectedResident) => void;
}

export const HouseholdRegistrationPanel: React.FC<HouseholdRegistrationPanelProps> = ({
  households,
  collections,
  onHouseholdCreated,
  onSelectHouseholdForCollection,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [areaFilter, setAreaFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COLLECTED' | 'PENDING'>('ALL');
  const [recentlyVerifiedOnly, setRecentlyVerifiedOnly] = useState(false);

  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [householdId, setHouseholdId] = useState('HH-2026-101');
  const [residentId, setResidentId] = useState('RES-901');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [area, setArea] = useState('');
  const [city, setCity] = useState('');
  const [pinCode, setPinCode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedQRHousehold, setSelectedQRHousehold] = useState<SelectedResident | null>(
    households[0] || null
  );

  const qrCanvasWrapperRef = useRef<HTMLDivElement | null>(null);

  const availableAreas = useMemo(() => {
    const set = new Set<string>();
    households.forEach((h) => {
      if (h.area) set.add(h.area);
    });
    return Array.from(set);
  }, [households]);

  const lastCollectionByHousehold = useMemo(() => {
    const map: Record<string, GarbageCollectionRecord> = {};
    collections.forEach((c) => {
      if (!c.householdId) return;
      const existing = map[c.householdId];
      const cTime = c.createdAt?.seconds ? c.createdAt.seconds * 1000 : 0;
      const eTime = existing?.createdAt?.seconds ? existing.createdAt.seconds * 1000 : 0;
      if (!existing || cTime >= eTime) {
        map[c.householdId] = c;
      }
    });
    return map;
  }, [collections]);

  const filteredHouseholds = useMemo(() => {
    return households.filter((h) => {
      const q = searchQuery.trim().toLowerCase();
      if (
        q &&
        !h.name.toLowerCase().includes(q) &&
        !h.householdId.toLowerCase().includes(q) &&
        !h.address.toLowerCase().includes(q)
      ) {
        return false;
      }

      if (areaFilter !== 'ALL' && h.area !== areaFilter) {
        return false;
      }

      const hasCollection =
        Boolean(lastCollectionByHousehold[h.householdId]) || (h.collectionsCount || 0) > 0;
      if (statusFilter === 'COLLECTED' && !hasCollection) return false;
      if (statusFilter === 'PENDING' && hasCollection) return false;

      if (recentlyVerifiedOnly && !hasCollection) return false;

      return true;
    });
  }, [households, searchQuery, areaFilter, statusFilter, recentlyVerifiedOnly, lastCollectionByHousehold]);

  const handleRegisterHousehold = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const currentUser = auth.currentUser;
    if (!currentUser) {
      setError('Please sign in with Google first to register a resident household in Firebase.');
      return;
    }

    const cleanHhId = householdId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanResId = residentId.trim().replace(/[^a-zA-Z0-9_-]/g, '');

    if (
      !cleanHhId ||
      !cleanResId ||
      !name.trim() ||
      !address.trim() ||
      !area.trim() ||
      !city.trim() ||
      !pinCode.trim()
    ) {
      setError('All household registration fields are required.');
      return;
    }

    setSaving(true);
    const docPath = `households/${cleanHhId}`;
    const token = cleanHhId;

    try {
      await setDoc(doc(db, 'households', cleanHhId), {
        residentId: cleanResId.slice(0, 128),
        householdId: cleanHhId.slice(0, 128),
        token: token.slice(0, 256),
        name: name.trim().slice(0, 120),
        address: address.trim().slice(0, 250),
        area: area.trim().slice(0, 120),
        city: city.trim().slice(0, 100),
        pinCode: pinCode.trim().slice(0, 20),
        rewardPoints: 0,
        collectionsCount: 0,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
      });

      const created: SelectedResident = {
        residentId: cleanResId,
        householdId: cleanHhId,
        token,
        name: name.trim(),
        address: address.trim(),
        area: area.trim(),
        city: city.trim(),
        pinCode: pinCode.trim(),
        rewardPoints: 0,
        collectionsCount: 0,
        ownerUid: currentUser.uid,
      };

      setSelectedQRHousehold(created);
      onHouseholdCreated(created);
      setShowRegisterForm(false);

      const nextNum = Math.floor(100 + Math.random() * 899);
      setHouseholdId(`HH-2026-${nextNum}`);
      setResidentId(`RES-${nextNum}`);
      setName('');
      setAddress('');
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, docPath);
      } catch (formattedErr: any) {
        setError(formattedErr.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const downloadQRImage = () => {
    const canvas = qrCanvasWrapperRef.current?.querySelector('canvas');
    if (!canvas || !selectedQRHousehold) return;
    const url = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `${selectedQRHousehold.householdId}-qr.png`;
    link.href = url;
    link.click();
  };

  const formatTimestamp = (ts: any) => {
    if (!ts) return 'No pickups yet';
    const millis = ts?.seconds ? ts.seconds * 1000 : Date.parse(String(ts));
    if (!millis || Number.isNaN(millis)) return 'Verified';
    return new Date(millis).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="bg-white border border-slate-200/90 rounded-[20px] p-6 shadow-xs space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Household Registry
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Search registered households, check verification status, and generate printable QR passes
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowRegisterForm((prev) => !prev)}
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-xs whitespace-nowrap cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>{showRegisterForm ? 'Close Registration Form' : 'Register Household'}</span>
          </button>
        </div>

        {/* Collapsible Registration Drawer */}
        {showRegisterForm && (
          <form
            onSubmit={handleRegisterHousehold}
            className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
              <h2 className="text-sm font-bold text-slate-900">
                Register New Household in Firebase
              </h2>
              <button
                type="button"
                onClick={() => setShowRegisterForm(false)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Household ID
                </label>
                <input
                  type="text"
                  value={householdId}
                  onChange={(e) => setHouseholdId(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 text-xs font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  placeholder="HH-2026-101"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Resident ID
                </label>
                <input
                  type="text"
                  value={residentId}
                  onChange={(e) => setResidentId(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 text-xs font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  placeholder="RES-901"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Resident Full Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  placeholder="e.g., Rajeshwar Sharma"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-1">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Full Street Address
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  placeholder="Plot 42, Green Park Extension"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Area / Ward
                </label>
                <input
                  type="text"
                  value={area}
                  onChange={(e) => setArea(e.target.value)}
                  required
                  className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  placeholder="Ward 14 South"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    placeholder="New Delhi"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    PIN Code
                  </label>
                  <input
                    type="text"
                    value={pinCode}
                    onChange={(e) => setPinCode(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    placeholder="110016"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800">
                {error}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="min-h-[42px] px-5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
              >
                <PlusCircle className="w-4 h-4" />
                <span>{saving ? 'Saving to Firebase...' : 'Save Household & Generate QR'}</span>
              </button>
            </div>
          </form>
        )}

        {/* Search & Filter Bar */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search resident or household ID"
              className="w-full pl-10 pr-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value)}
              className="min-h-[40px] px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl text-slate-700"
            >
              <option value="ALL">All Areas</option>
              {availableAreas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="min-h-[40px] px-3 py-2 text-xs font-medium bg-slate-50 border border-slate-200 rounded-xl text-slate-700"
            >
              <option value="ALL">All Statuses</option>
              <option value="COLLECTED">Verified Pickups</option>
              <option value="PENDING">Pending First Pickup</option>
            </select>

            <button
              type="button"
              onClick={() => setRecentlyVerifiedOnly((prev) => !prev)}
              className={`min-h-[40px] px-3.5 py-2 text-xs font-semibold rounded-xl border transition-colors cursor-pointer whitespace-nowrap ${
                recentlyVerifiedOnly
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              Recently Verified
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Grid: Household Cards + Selected QR Pass Preview */}
      {households.length === 0 ? (
        <div className="bg-white border border-slate-200/90 rounded-[20px] p-12 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto">
            <Home className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900">
            No households found
          </h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            Register a household above to generate its unique Firebase QR code for field verification.
          </p>
          <button
            type="button"
            onClick={() => setShowRegisterForm(true)}
            className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>Register First Household</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left 8 Columns: Household List */}
          <div className="lg:col-span-8 space-y-3">
            {filteredHouseholds.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-[20px] p-8 text-center text-xs text-slate-500">
                No households found matching your search or filter criteria.
              </div>
            ) : (
              filteredHouseholds.map((hh) => {
                const lastCol = lastCollectionByHousehold[hh.householdId];
                const isSelected = selectedQRHousehold?.householdId === hh.householdId;
                return (
                  <div
                    key={hh.householdId}
                    onClick={() => setSelectedQRHousehold(hh)}
                    className={`p-5 rounded-[18px] bg-white border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-emerald-500 shadow-sm ring-1 ring-emerald-500/20'
                        : 'border-slate-200/90 hover:border-slate-300 shadow-2xs'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-start gap-3.5">
                        <div className="w-10 h-10 rounded-xl bg-slate-900 text-white font-bold text-sm flex items-center justify-center shrink-0">
                          {hh.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-bold text-slate-900">
                              {hh.name}
                            </h3>
                            <span className="text-slate-300">·</span>
                            <span className="font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                              {hh.householdId}
                            </span>
                          </div>
                          <p className="text-xs text-slate-600 mt-1 flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span>
                              {hh.address} · {hh.area}, {hh.city} ({hh.pinCode})
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectHouseholdForCollection(hh);
                          }}
                          className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer"
                        >
                          START WASTE INSPECTION →
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Status: Verified</span>
                        </span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          <span>
                            Last Collection:{' '}
                            {lastCol ? formatTimestamp(lastCol.createdAt) : 'None yet'}
                          </span>
                        </span>
                      </div>

                      <div className="flex items-center gap-3 font-mono tabular-nums">
                        <span>Pickups: {hh.collectionsCount || 0}</span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                          <Award className="w-3.5 h-3.5" />
                          <span>{hh.rewardPoints || 0} pts</span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Right 4 Columns: Active Scannable QR Pass Card */}
          <div className="lg:col-span-4 bg-white border border-slate-200/90 rounded-[20px] p-6 shadow-xs sticky top-20 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Household QR Pass
                </h3>
                <p className="text-xs text-slate-500">
                  Scan with Collector QR Camera
                </p>
              </div>
              <QrCode className="w-5 h-5 text-emerald-600" />
            </div>

            {selectedQRHousehold ? (
              <div className="flex flex-col items-center text-center space-y-4">
                <div
                  ref={qrCanvasWrapperRef}
                  className="p-4 bg-white rounded-2xl border border-slate-200 shadow-2xs"
                >
                  <QRCodeCanvas
                    value={JSON.stringify({
                      householdId: selectedQRHousehold.householdId,
                      residentId: selectedQRHousehold.residentId,
                      token: selectedQRHousehold.token,
                    })}
                    size={176}
                    level="M"
                    includeMargin={true}
                  />
                </div>
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1 text-emerald-700 text-xs font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Verified Firebase Token</span>
                  </div>
                  <p className="text-base font-bold text-slate-900">
                    {selectedQRHousehold.name}
                  </p>
                  <p className="text-xs font-mono font-semibold text-slate-700 tabular-nums">
                    {selectedQRHousehold.householdId}
                  </p>
                  <p className="text-xs text-slate-500">
                    {selectedQRHousehold.address} · {selectedQRHousehold.area}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={downloadQRImage}
                  className="w-full min-h-[42px] px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Download QR Image</span>
                </button>
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-slate-500">
                Select any household on the left to view or download its QR pass.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
