/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
} from './firebase';
import {
  CollectorRecord,
  GarbageCollectionRecord,
  GovernmentIncentiveProgram,
  ResidentRecord,
  SavableWasteCategory,
  UserAccountRecord,
  UserRole,
} from './types';
import { ResidentDashboard } from './components/ResidentDashboard';
import { CollectorDashboard } from './components/CollectorDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import {
  ShieldCheck,
  LogIn,
  LogOut,
  UserCheck,
  Truck,
  Landmark,
  AlertCircle,
  Loader2,
  CheckCircle2,
} from 'lucide-react';

type RoutePath = '/resident' | '/collector' | '/admin' | '/login';

const ROLE_TO_ROUTE: Record<UserRole, RoutePath> = {
  resident: '/resident',
  collector: '/collector',
  admin: '/admin',
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // User Role & Account state in Firestore `users/{uid}`
  const [userAccount, setUserAccount] = useState<UserAccountRecord | null>(null);
  const [roleLoading, setRoleLoading] = useState<boolean>(true);
  const [roleConfigError, setRoleConfigError] = useState<string | null>(null);

  // Role configuration / onboarding form when user first authenticates or role is missing
  const [selectedRoleSetup, setSelectedRoleSetup] = useState<UserRole>('collector');
  const [setupName, setSetupName] = useState('');
  const [setupPhone, setSetupPhone] = useState('');
  // Resident setup fields
  const [setupAddress, setSetupAddress] = useState('');
  const [setupArea, setSetupArea] = useState('Sector 14');
  const [setupCity, setSetupCity] = useState('New Delhi');
  const [setupPin, setSetupPin] = useState('110001');
  // Collector setup fields
  const [setupVehicleId, setSetupVehicleId] = useState('DL-1GC-4092');
  const [savingRoleSetup, setSavingRoleSetup] = useState(false);

  // Browser URL route synchronization (`/resident`, `/collector`, `/admin`)
  const [currentRoute, setCurrentRoute] = useState<string>(() => {
    return window.location.pathname || '/';
  });

  // Real Firestore Collections
  const [residents, setResidents] = useState<ResidentRecord[]>([]);
  const [collectors, setCollectors] = useState<CollectorRecord[]>([]);
  const [collections, setCollections] = useState<GarbageCollectionRecord[]>([]);
  const [incentives, setIncentives] = useState<GovernmentIncentiveProgram[]>([]);

  const navigateTo = (path: RoutePath) => {
    if (window.location.pathname !== path) {
      window.history.replaceState({}, '', path);
    }
    setCurrentRoute(path);
  };

  useEffect(() => {
    const handlePopState = () => {
      setCurrentRoute(window.location.pathname || '/');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // 1. Firebase Auth Listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthReady(true);
      if (currentUser) {
        setSetupName(
          currentUser.displayName || currentUser.email?.split('@')[0] || 'EcoVerify User'
        );
      } else {
        setUserAccount(null);
        setRoleLoading(false);
        setRoleConfigError(null);
      }
    });
    return () => unsub();
  }, []);

  // 2. Read Authenticated User's Role from Firestore (`users/{uid}`) and enforce route protection
  useEffect(() => {
    if (!authReady || !user) {
      setUserAccount(null);
      setRoleLoading(false);
      return;
    }

    setRoleLoading(true);
    setRoleConfigError(null);

    const userDocRef = doc(db, 'users', user.uid);
    const unsubUser = onSnapshot(
      userDocRef,
      (snap) => {
        if (!snap.exists()) {
          setUserAccount(null);
          setRoleConfigError(
            'Role not configured for this account. Select and register your role below.'
          );
          setRoleLoading(false);
          return;
        }

        const data = snap.data();
        const role = data?.role as UserRole | undefined;
        if (role !== 'resident' && role !== 'collector' && role !== 'admin') {
          setUserAccount(null);
          setRoleConfigError(
            `Invalid role "${String(role || 'none')}" in Firestore. Role not configured.`
          );
          setRoleLoading(false);
          return;
        }

        const account: UserAccountRecord = {
          uid: user.uid,
          email: String(data.email || user.email || ''),
          name: String(data.name || user.displayName || 'User'),
          role,
          residentId: data.residentId ? String(data.residentId) : undefined,
          collectorId: data.collectorId ? String(data.collectorId) : undefined,
          phone: data.phone ? String(data.phone) : undefined,
          createdAt: data.createdAt,
        };

        setUserAccount(account);
        setRoleConfigError(null);
        setRoleLoading(false);

        // Redirect ONLY to that role's dashboard and protect against unauthorized routes
        const targetRoute = ROLE_TO_ROUTE[role];
        navigateTo(targetRoute);
      },
      (err) => {
        setRoleLoading(false);
        setRoleConfigError('Unable to read user role from Firestore.');
        try {
          handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
        } catch (e) {
          console.error(e);
        }
      }
    );

    return () => unsubUser();
  }, [authReady, user]);

  // Enforce strict route protection if URL changes manually
  useEffect(() => {
    if (!userAccount) return;
    const allowedRoute = ROLE_TO_ROUTE[userAccount.role];
    if (currentRoute !== allowedRoute) {
      navigateTo(allowedRoute);
    }
  }, [currentRoute, userAccount]);

  // 3. Real Firestore Subscriptions for Residents, Collectors, Collections, and Incentives
  useEffect(() => {
    if (!authReady || !user || !userAccount) {
      setResidents([]);
      setCollectors([]);
      setCollections([]);
      setIncentives([]);
      return;
    }

    const unsubResidents = onSnapshot(
      collection(db, 'residents'),
      (snap) => {
        const list: ResidentRecord[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          const id = String(d.residentId || d.householdId || docSnap.id);
          return {
            residentId: id,
            householdId: String(d.householdId || id),
            name: String(d.name || 'Resident'),
            address: String(d.address || ''),
            area: String(d.area || ''),
            city: String(d.city || ''),
            pin: String(d.pin || d.pinCode || ''),
            phone: String(d.phone || ''),
            rewardPoints: Number(d.rewardPoints || 0),
            collectionsCount: Number(d.collectionsCount || 0),
            role: 'resident',
            ownerUid: String(d.ownerUid || user.uid),
            eligibleForAdminReview: Boolean(d.eligibleForAdminReview),
            createdAt: d.createdAt,
          };
        });
        setResidents(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'residents');
        } catch (e) {
          console.error(e);
        }
      }
    );

    const unsubCollectors = onSnapshot(
      collection(db, 'collectors'),
      (snap) => {
        const list: CollectorRecord[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          return {
            collectorId: String(d.collectorId || docSnap.id),
            name: String(d.name || 'Collector'),
            phone: String(d.phone || ''),
            vehicleId: String(d.vehicleId || 'DL-1GC-4092'),
            assignedArea: String(d.assignedArea || 'Central Zone'),
            role: 'collector',
            ownerUid: String(d.ownerUid || d.uid || user.uid),
            gpsActive: Boolean(d.gpsActive),
            latitude: typeof d.latitude === 'number' ? d.latitude : undefined,
            longitude: typeof d.longitude === 'number' ? d.longitude : undefined,
            updatedAt: d.updatedAt,
            createdAt: d.createdAt,
          };
        });
        setCollectors(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'collectors');
        } catch (e) {
          console.error(e);
        }
      }
    );

    const unsubCollections = onSnapshot(
      collection(db, 'collections'),
      (snap) => {
        const list: GarbageCollectionRecord[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          const cat = (d.wasteCategory || d.wasteType || 'OTHER') as SavableWasteCategory;
          const pts = Number(d.rewardPoints ?? d.rewardPointsEarned ?? 0);
          return {
            collectionId: String(d.collectionId || docSnap.id),
            residentId: String(d.residentId || d.householdId || ''),
            householdId: String(d.householdId || d.residentId || ''),
            residentName: String(d.residentName || ''),
            address: String(d.address || d.residentAddress || ''),
            area: String(d.area || ''),
            city: String(d.city || ''),
            pinCode: String(d.pinCode || d.pin || ''),
            collectorId: String(d.collectorId || d.collectorUid || ''),
            collectorUid: String(d.collectorUid || d.collectorId || ''),
            collectorName: String(d.collectorName || ''),
            vehicleId: String(d.vehicleId || d.vehicleNumber || 'DL-1GC-4092'),
            vehicleNumber: String(d.vehicleNumber || d.vehicleId || 'DL-1GC-4092'),
            wasteType: String(d.wasteType || cat),
            wasteCategory: cat,
            detectedObject: String(d.detectedObject || ''),
            confidence: Number(d.confidence || 0),
            reason: String(d.reason || d.aiReason || ''),
            imageUrl: String(d.imageUrl || ''),
            latitude: typeof d.latitude === 'number' ? d.latitude : 0,
            longitude: typeof d.longitude === 'number' ? d.longitude : 0,
            gpsLocation: String(d.gpsLocation || ''),
            rewardPoints: pts,
            rewardPointsEarned: pts,
            status: 'VERIFIED',
            timestamp: d.timestamp || d.createdAt,
            createdAt: d.createdAt || d.timestamp,
          };
        });
        list.sort((a, b) => {
          const tA = a.timestamp?.seconds || a.createdAt?.seconds || 0;
          const tB = b.timestamp?.seconds || b.createdAt?.seconds || 0;
          return tB - tA;
        });
        setCollections(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'collections');
        } catch (e) {
          console.error(e);
        }
      }
    );

    const unsubIncentives = onSnapshot(
      collection(db, 'incentives'),
      (snap) => {
        const list: GovernmentIncentiveProgram[] = snap.docs.map((docSnap) => {
          const d = docSnap.data();
          const incId = String(d.incentiveId || d.programId || docSnap.id);
          return {
            incentiveId: incId,
            programName: String(d.programName || ''),
            eligibility: String(d.eligibility || ''),
            rewardAmount: String(d.rewardAmount || ''),
            startDate: String(d.startDate || ''),
            endDate: String(d.endDate || ''),
            status: d.status || 'ACTIVE',
            notes: String(d.notes || ''),
            supportingDocuments: String(d.supportingDocuments || ''),
            createdByUid: String(d.createdByUid || ''),
            createdAt: d.createdAt,
          };
        });
        setIncentives(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, 'incentives');
        } catch (e) {
          console.error(e);
        }
      }
    );

    return () => {
      unsubResidents();
      unsubCollectors();
      unsubCollections();
      unsubIncentives();
    };
  }, [authReady, user, userAccount]);

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      setAuthError(err?.message || 'Firebase Google authentication failed.');
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    navigateTo('/login');
  };

  // Save Role & Profile Document in Firestore (`users/{uid}` + `residents/{id}` or `collectors/{id}`)
  const handleCompleteRoleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSavingRoleSetup(true);
    setAuthError(null);

    try {
      const cleanName = setupName.trim() || user.displayName || 'EcoVerify User';
      const cleanPhone = setupPhone.trim() || '+91-9800000000';
      const shortCode = user.uid.slice(0, 6).toUpperCase();

      if (selectedRoleSetup === 'resident') {
        const residentId = `RES-${shortCode}`;
        const qrToken = `ECOVERIFY_RESIDENT:${residentId}`;

        const existingResidentSnap = await getDoc(doc(db, 'residents', residentId));
        if (!existingResidentSnap.exists()) {
          await setDoc(doc(db, 'residents', residentId), {
            residentId,
            householdId: residentId,
            name: cleanName,
            address: setupAddress.trim() || 'House 12, Green Park Main',
            area: setupArea.trim() || 'Sector 14',
            city: setupCity.trim() || 'New Delhi',
            pin: setupPin.trim() || '110001',
            phone: cleanPhone,
            rewardPoints: 0,
            collectionsCount: 0,
            role: 'resident',
            ownerUid: user.uid,
            createdAt: serverTimestamp(),
          });
        }

        // Also keep backwards-compatible `households/{residentId}` document
        await setDoc(
          doc(db, 'households', residentId),
          {
            residentId,
            householdId: residentId,
            token: qrToken,
            name: cleanName,
            address: setupAddress.trim() || 'House 12, Green Park Main',
            area: setupArea.trim() || 'Sector 14',
            city: setupCity.trim() || 'New Delhi',
            pinCode: setupPin.trim() || '110001',
            rewardPoints: 0,
            collectionsCount: 0,
            ownerUid: user.uid,
            createdAt: serverTimestamp(),
          },
          { merge: true }
        );

        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email || '',
          name: cleanName,
          role: 'resident',
          residentId,
          phone: cleanPhone,
          createdAt: serverTimestamp(),
        });
      } else if (selectedRoleSetup === 'collector') {
        const collectorId = `COL-${shortCode}`;
        const existingCollectorSnap = await getDoc(doc(db, 'collectors', collectorId));
        if (!existingCollectorSnap.exists()) {
          await setDoc(doc(db, 'collectors', collectorId), {
            collectorId,
            name: cleanName,
            phone: cleanPhone,
            vehicleId: setupVehicleId.trim() || 'DL-1GC-4092',
            assignedArea: setupArea.trim() || 'Sector 14',
            role: 'collector',
            ownerUid: user.uid,
            gpsActive: false,
            createdAt: serverTimestamp(),
          });
        }

        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email || '',
          name: cleanName,
          role: 'collector',
          collectorId,
          phone: cleanPhone,
          createdAt: serverTimestamp(),
        });
      } else {
        // Admin role
        await setDoc(doc(db, 'users', user.uid), {
          uid: user.uid,
          email: user.email || '',
          name: cleanName,
          role: 'admin',
          phone: cleanPhone,
          createdAt: serverTimestamp(),
        });
      }
    } catch (err: any) {
      setAuthError(err?.message || 'Failed to save role configuration to Firestore.');
    } finally {
      setSavingRoleSetup(false);
    }
  };

  // Loading state while verifying Firebase Auth & Firestore Role
  if (!authReady || (user && roleLoading)) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-sm w-full text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
          <div className="space-y-1">
            <h1 className="text-base font-bold text-slate-900">EcoVerify</h1>
            <p className="text-xs text-slate-500">
              Verifying Firebase authentication &amp; role permissions...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Unauthenticated Login Screen
  if (!user) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-between p-4 sm:p-8">
        <header className="max-w-5xl w-full mx-auto flex items-center justify-between py-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <span className="text-base font-bold text-slate-900 block leading-none">
                EcoVerify
              </span>
              <span className="text-[11px] text-slate-500">
                Smart Waste Collection &amp; Verification
              </span>
            </div>
          </div>
        </header>

        <main className="max-w-md w-full mx-auto my-auto">
          <div className="bg-white border border-slate-200/90 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
            <div className="space-y-2 text-center">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Sign in to EcoVerify
              </h1>
              <p className="text-xs text-slate-500 leading-relaxed">
                Role-based portal for Residents, Garbage Collectors, and Municipal Administrators.
              </p>
            </div>

            {authError && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            <div className="space-y-3 pt-1">
              <button
                type="button"
                onClick={handleGoogleSignIn}
                className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold flex items-center justify-center gap-2.5 shadow-xs transition-colors cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>Sign In with Google</span>
              </button>
            </div>

            <div className="pt-4 border-t border-slate-100 grid grid-cols-3 gap-2 text-center">
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/60">
                <UserCheck className="w-4 h-4 text-emerald-600 mx-auto mb-1" />
                <p className="text-[11px] font-bold text-slate-800">Resident</p>
                <p className="text-[10px] text-slate-500 font-mono">/resident</p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/60">
                <Truck className="w-4 h-4 text-indigo-600 mx-auto mb-1" />
                <p className="text-[11px] font-bold text-slate-800">Collector</p>
                <p className="text-[10px] text-slate-500 font-mono">/collector</p>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/60">
                <Landmark className="w-4 h-4 text-slate-800 mx-auto mb-1" />
                <p className="text-[11px] font-bold text-slate-800">Admin</p>
                <p className="text-[10px] text-slate-500 font-mono">/admin</p>
              </div>
            </div>
          </div>
        </main>

        <footer className="text-center text-xs text-slate-400 py-2">
          EcoVerify Municipal Waste Verification Platform
        </footer>
      </div>
    );
  }

  // Authenticated but Role Not Configured or Invalid in Firestore
  if (!userAccount || roleConfigError) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 sm:p-6">
        <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-base font-bold text-slate-900">Role Not Configured</h1>
                <p className="text-xs text-slate-500">{user.email}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>

          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Role configuration required in Firestore</p>
              <p className="mt-0.5 text-amber-800">
                {roleConfigError ||
                  'Your account does not have an assigned role yet. Select your role below to provision your Firestore profile and open your dedicated dashboard.'}
              </p>
            </div>
          </div>

          {authError && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-xs font-medium text-red-700">
              {authError}
            </div>
          )}

          <form onSubmit={handleCompleteRoleSetup} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Select Account Role
              </label>
              <div className="grid grid-cols-3 gap-2.5">
                {(
                  [
                    { id: 'resident', label: 'Resident', route: '/resident', icon: UserCheck },
                    { id: 'collector', label: 'Collector', route: '/collector', icon: Truck },
                    { id: 'admin', label: 'Admin', route: '/admin', icon: Landmark },
                  ] as const
                ).map((item) => {
                  const Icon = item.icon;
                  const active = selectedRoleSetup === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedRoleSetup(item.id)}
                      className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                        active
                          ? 'bg-emerald-50/90 border-emerald-600 text-emerald-950 shadow-2xs'
                          : 'bg-slate-50/70 border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 mb-1.5 ${
                          active ? 'text-emerald-600' : 'text-slate-500'
                        }`}
                      />
                      <span className="text-xs font-bold block">{item.label}</span>
                      <span className="text-[10px] font-mono text-slate-500 block">
                        {item.route}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={setupName}
                  onChange={(e) => setSetupName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-emerald-600"
                  placeholder="Enter full name"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Phone Number
                </label>
                <input
                  type="text"
                  required
                  value={setupPhone}
                  onChange={(e) => setSetupPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-emerald-600"
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>

            {selectedRoleSetup === 'resident' && (
              <div className="space-y-3 pt-1 border-t border-slate-100">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Street Address / House Number
                  </label>
                  <input
                    type="text"
                    required
                    value={setupAddress}
                    onChange={(e) => setSetupAddress(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-emerald-600"
                    placeholder="House No. 42, Green Park"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Area / Ward
                    </label>
                    <input
                      type="text"
                      required
                      value={setupArea}
                      onChange={(e) => setSetupArea(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      City
                    </label>
                    <input
                      type="text"
                      required
                      value={setupCity}
                      onChange={(e) => setSetupCity(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      PIN Code
                    </label>
                    <input
                      type="text"
                      required
                      value={setupPin}
                      onChange={(e) => setSetupPin(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-900 font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            {selectedRoleSetup === 'collector' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-100">
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Assigned Vehicle ID
                  </label>
                  <input
                    type="text"
                    required
                    value={setupVehicleId}
                    onChange={(e) => setSetupVehicleId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-mono text-slate-900"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Assigned Collection Area
                  </label>
                  <input
                    type="text"
                    required
                    value={setupArea}
                    onChange={(e) => setSetupArea(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-900"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={savingRoleSetup}
              className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {savingRoleSetup ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving Role to Firestore...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Complete Role Setup &amp; Open Dashboard</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ============================================================================
  // STRICT SEPARATE ROLE-BASED DASHBOARD ROUTING (/resident, /collector, /admin)
  // ============================================================================

  if (userAccount.role === 'resident') {
    const shortId = userAccount.residentId || `RES-${user.uid.slice(0, 6).toUpperCase()}`;
    const matchedResident: ResidentRecord =
      residents.find(
        (r) => r.residentId === shortId || r.ownerUid === user.uid
      ) || {
        residentId: shortId,
        householdId: shortId,
        name: userAccount.name,
        address: 'Registered Household',
        area: 'Sector 14',
        city: 'New Delhi',
        pin: '110001',
        phone: userAccount.phone || '',
        rewardPoints: 0,
        collectionsCount: 0,
        role: 'resident',
        ownerUid: user.uid,
      };

    return (
      <ResidentDashboard
        user={user}
        residentProfile={matchedResident}
        allResidents={residents}
        allCollections={collections}
        onSignOut={handleSignOut}
      />
    );
  }

  if (userAccount.role === 'collector') {
    const shortColId = userAccount.collectorId || `COL-${user.uid.slice(0, 6).toUpperCase()}`;
    const matchedCollector: CollectorRecord =
      collectors.find(
        (c) => c.collectorId === shortColId || c.ownerUid === user.uid
      ) || {
        collectorId: shortColId,
        name: userAccount.name,
        phone: userAccount.phone || '',
        vehicleId: 'DL-1GC-4092',
        assignedArea: 'Sector 14',
        role: 'collector',
        ownerUid: user.uid,
        gpsActive: false,
      };

    const collectorCollections = collections.filter(
      (c) => c.collectorUid === user.uid || c.collectorId === shortColId
    );

    return (
      <CollectorDashboard
        user={user}
        collectorProfile={matchedCollector}
        collections={collectorCollections}
        onSignOut={handleSignOut}
      />
    );
  }

  // Admin Role (`/admin`)
  return (
    <AdminDashboard
      user={user}
      residents={residents}
      collectors={collectors}
      collections={collections}
      incentives={incentives}
      onSignOut={handleSignOut}
    />
  );
}
