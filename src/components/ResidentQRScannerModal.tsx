import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { doc, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { SelectedResident } from '../types';
import {
  X,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  QrCode,
  ArrowRight,
  ShieldCheck,
  MapPin,
  SwitchCamera,
  Zap,
  ZapOff,
  Camera,
} from 'lucide-react';

interface ResidentQRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResidentVerified: (resident: SelectedResident) => void;
  onStartGarbageCollection: (resident: SelectedResident) => void;
  inlineMode?: boolean;
}

export const ResidentQRScannerModal: React.FC<ResidentQRScannerModalProps> = ({
  isOpen,
  onClose,
  onResidentVerified,
  onStartGarbageCollection,
  inlineMode = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<'permission_required' | 'unavailable' | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [verifiedResident, setVerifiedResident] = useState<SelectedResident | null>(null);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setTorchSupported(false);
    setTorchOn(false);
  }, []);

  const parseResidentOrHouseholdIdFromQR = (
    rawQR: string
  ): { id: string; token: string } => {
    const trimmed = rawQR.trim();
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        const extracted = String(
          parsed.residentId || parsed.householdId || parsed.id || parsed.token || ''
        ).trim();
        if (extracted) {
          return { id: extracted, token: extracted };
        }
      }
    } catch {
      // Plain text ID
    }

    try {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        const url = new URL(trimmed);
        const paramId =
          url.searchParams.get('residentId') ||
          url.searchParams.get('householdId') ||
          url.searchParams.get('token') ||
          url.searchParams.get('id');
        if (paramId) {
          return { id: paramId.trim(), token: paramId.trim() };
        }
        const lastSegment = url.pathname.split('/').filter(Boolean).pop();
        if (lastSegment) {
          return { id: lastSegment.trim(), token: lastSegment.trim() };
        }
      }
    } catch {
      // Not a URL
    }

    const cleanId = trimmed.replace(/[^a-zA-Z0-9_-]/g, '');
    return { id: cleanId || trimmed, token: trimmed };
  };

  const lookupResidentInFirestore = useCallback(
    async (rawQrData: string) => {
      const { id: targetId } = parseResidentOrHouseholdIdFromQR(rawQrData);
      if (!targetId || !/^[a-zA-Z0-9_-]+$/.test(targetId)) {
        setLookupError(
          `Invalid QR code "${rawQrData.slice(0, 40)}". Please scan a valid Resident QR code.`
        );
        return;
      }

      setLookingUp(true);
      setLookupError(null);
      stopCamera();

      try {
        // 1. Check residents/{residentId} collection first
        const resSnap = await getDoc(doc(db, 'residents', targetId));
        if (resSnap.exists()) {
          const d = resSnap.data();
          const resident: SelectedResident = {
            residentId: String(d.residentId || targetId),
            householdId: String(d.householdId || targetId),
            token: String(d.residentId || d.householdId || targetId),
            name: String(d.name || ''),
            address: String(d.address || ''),
            area: String(d.area || ''),
            city: String(d.city || ''),
            pinCode: String(d.pin || d.pinCode || ''),
            pin: String(d.pin || d.pinCode || ''),
            phone: String(d.phone || ''),
            rewardPoints: Number(d.rewardPoints || 0),
            collectionsCount: Number(d.collectionsCount || 0),
            ownerUid: d.ownerUid ? String(d.ownerUid) : undefined,
          };
          setVerifiedResident(resident);
          onResidentVerified(resident);
          return;
        }

        // 2. Also check households/{householdId} collection
        const hhSnap = await getDoc(doc(db, 'households', targetId));
        if (hhSnap.exists()) {
          const d = hhSnap.data();
          const resident: SelectedResident = {
            residentId: String(d.residentId || targetId),
            householdId: String(d.householdId || targetId),
            token: String(d.token || targetId),
            name: String(d.name || ''),
            address: String(d.address || ''),
            area: String(d.area || ''),
            city: String(d.city || ''),
            pinCode: String(d.pinCode || d.pin || ''),
            pin: String(d.pin || d.pinCode || ''),
            phone: String(d.phone || ''),
            rewardPoints: Number(d.rewardPoints || 0),
            collectionsCount: Number(d.collectionsCount || 0),
            ownerUid: d.ownerUid ? String(d.ownerUid) : undefined,
          };
          setVerifiedResident(resident);
          onResidentVerified(resident);
          return;
        }

        setLookupError(
          `No registered resident found in Firestore for ID: "${targetId}".`
        );
      } catch (err) {
        try {
          handleFirestoreError(err, OperationType.GET, `residents/${targetId}`);
        } catch (formattedErr: any) {
          setLookupError(`Firestore lookup error: ${formattedErr.message}`);
        }
      } finally {
        setLookingUp(false);
      }
    },
    [onResidentVerified, stopCamera]
  );

  const scanFrameForQR = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || verifiedResident || lookingUp) return;

    if (
      video.readyState === video.HAVE_ENOUGH_DATA &&
      video.videoWidth > 0 &&
      video.videoHeight > 0
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code && code.data && code.data.trim().length > 0) {
          lookupResidentInFirestore(code.data);
          return;
        }
      }
    }

    rafRef.current = requestAnimationFrame(scanFrameForQR);
  }, [lookupResidentInFirestore, lookingUp, verifiedResident]);

  const requestCapacitorCameraPermissionIfAvailable = async () => {
    try {
      const cap = (window as any)?.Capacitor;
      if (cap?.Plugins?.Camera?.requestPermissions) {
        const permResult = await cap.Plugins.Camera.requestPermissions({
          permissions: ['camera'],
        });
        if (permResult?.camera === 'denied') {
          return false;
        }
      }
    } catch {
      // Ignore if running in standard web container
    }
    return true;
  };

  const startCamera = useCallback(
    async (mode: 'environment' | 'user' = facingMode) => {
      stopCamera();
      setCameraError(null);
      setLookupError(null);

      const allowedByNative = await requestCapacitorCameraPermissionIfAvailable();
      if (!allowedByNative) {
        setCameraError('permission_required');
        return;
      }

      if (
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setCameraError('permission_required');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        streamRef.current = stream;

        // Check hardware flash/torch capability on the active video track
        const [videoTrack] = stream.getVideoTracks();
        if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
          const caps: any = videoTrack.getCapabilities();
          if (caps && caps.torch) {
            setTorchSupported(true);
          }
        }

        if (videoRef.current) {
          const video = videoRef.current;
          video.srcObject = stream;
          video.autoplay = true;
          video.playsInline = true;
          video.muted = true;
          await video.play().catch(() => {});
          setCameraReady(true);
          rafRef.current = requestAnimationFrame(scanFrameForQR);
        }
      } catch (err: any) {
        console.error('QR Scanner Camera Error:', err);
        setCameraError('permission_required');
      }
    },
    [facingMode, scanFrameForQR, stopCamera]
  );

  useEffect(() => {
    if (isOpen && !verifiedResident) {
      startCamera(facingMode);
    } else if (!isOpen) {
      stopCamera();
      setVerifiedResident(null);
      setLookupError(null);
      setCameraError(null);
    }

    return () => {
      stopCamera();
    };
  }, [isOpen, verifiedResident, facingMode, startCamera, stopCamera]);

  const handleToggleCameraFacing = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
  };

  const handleToggleTorch = async () => {
    if (!streamRef.current) return;
    const [track] = streamRef.current.getVideoTracks();
    if (!track) return;
    try {
      const nextTorch = !torchOn;
      await track.applyConstraints({
        advanced: [{ torch: nextTorch } as any],
      });
      setTorchOn(nextTorch);
    } catch {
      // Torch constraint not supported on this device
    }
  };

  const handleClose = () => {
    stopCamera();
    onClose();
  };

  if (!isOpen) return null;

  const content = (
    <div className="w-full max-w-xl mx-auto rounded-[24px] bg-white border border-slate-200 shadow-xl overflow-hidden">
      {/* Top Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-900 text-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 shrink-0">
            <QrCode className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold tracking-tight">
              Scan Resident QR
            </h2>
            <p className="text-xs text-slate-300">
              Live Rear Camera Household Verification
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!verifiedResident && !cameraError && torchSupported && (
            <button
              type="button"
              onClick={handleToggleTorch}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 transition-colors cursor-pointer"
              title="Toggle Flash"
            >
              {torchOn ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
            </button>
          )}
          {!verifiedResident && !cameraError && (
            <button
              type="button"
              onClick={handleToggleCameraFacing}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-white transition-colors cursor-pointer"
              title="Switch Camera"
            >
              <SwitchCamera className="w-4 h-4" />
            </button>
          )}
          {!inlineMode && (
            <button
              type="button"
              onClick={handleClose}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
              aria-label="Close Scanner"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className="p-5 space-y-5">
        <canvas ref={canvasRef} className="hidden" />

        {/* Verified Resident Card */}
        {verifiedResident ? (
          <div className="space-y-5">
            <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 text-emerald-900 font-bold text-base">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>RESIDENT VERIFIED ✓</span>
                </div>
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Firestore Verified</span>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 text-sm border-t border-emerald-200/70 pt-4">
                <div>
                  <span className="text-xs font-medium text-slate-500 block">
                    Resident Name
                  </span>
                  <span className="text-sm font-bold text-slate-900 mt-0.5 block">
                    {verifiedResident.name}
                  </span>
                </div>
                <div>
                  <span className="text-xs font-medium text-slate-500 block">
                    Household ID
                  </span>
                  <span className="text-sm font-mono font-bold text-slate-900 tabular-nums mt-0.5 block">
                    {verifiedResident.householdId}
                  </span>
                </div>
                <div className="sm:col-span-2">
                  <span className="text-xs font-medium text-slate-500 block">
                    Address
                  </span>
                  <span className="text-sm text-slate-800 mt-0.5 flex items-start gap-1.5">
                    <MapPin className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{verifiedResident.address}</span>
                  </span>
                </div>
                <div>
                  <span className="text-xs font-medium text-slate-500 block">
                    Area
                  </span>
                  <span className="text-sm font-medium text-slate-800 mt-0.5 block">
                    {verifiedResident.area}
                  </span>
                </div>
                <div>
                  <span className="text-xs font-medium text-slate-500 block">
                    City &amp; PIN
                  </span>
                  <span className="text-sm font-medium text-slate-800 tabular-nums mt-0.5 block">
                    {verifiedResident.city} · {verifiedResident.pinCode}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  onStartGarbageCollection(verifiedResident);
                }}
                className="flex-1 min-h-[50px] px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer"
              >
                <span>Continue to Waste Inspection</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setVerifiedResident(null);
                  startCamera(facingMode);
                }}
                className="min-h-[50px] px-4 py-3 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Scan Another QR</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Native Capacitor / Android Camera Permission Required State */}
            {cameraError && (
              <div className="p-6 rounded-2xl bg-red-50 border border-red-200 space-y-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto">
                  <Camera className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-red-950">
                    Camera Permission Required
                  </h3>
                  <p className="text-xs text-red-800 max-w-sm mx-auto">
                    Grant native camera permission to scan the Resident QR code with the device rear camera.
                  </p>
                </div>
                <div className="flex items-center justify-center pt-1">
                  <button
                    type="button"
                    onClick={() => startCamera(facingMode)}
                    className="min-h-[46px] px-5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Request Camera Permission</span>
                  </button>
                </div>
              </div>
            )}

            {/* Live Rear Camera Viewport */}
            {!cameraError && (
              <div className="space-y-3">
                <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3] sm:aspect-video border border-slate-800 flex items-center justify-center">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
                    <div className="relative w-52 h-52 border-2 border-emerald-400/90 rounded-2xl shadow-[0_0_0_9999px_rgba(15,23,42,0.5)] overflow-hidden">
                      <div className="w-full h-0.5 bg-emerald-400 shadow-[0_0_12px_#34d399] animate-qr-beam" />
                    </div>
                  </div>
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between px-3.5 py-2 rounded-xl bg-slate-950/80 backdrop-blur-xs text-white text-xs">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>
                        {cameraReady
                          ? 'Point rear camera at Resident QR'
                          : 'Opening rear camera...'}
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-emerald-400 font-semibold">
                      REAR CAM
                    </span>
                  </div>
                </div>
              </div>
            )}

            {lookingUp && (
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center gap-2.5 text-sm text-slate-700 font-medium">
                <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                <span>Verifying Resident ID in Firestore...</span>
              </div>
            )}

            {lookupError && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-200 space-y-3">
                <div className="flex items-center gap-2 text-red-900 font-semibold text-xs">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{lookupError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => startCamera(facingMode)}
                  className="min-h-[42px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Scan Again
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  if (inlineMode) {
    return content;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
      {content}
    </div>
  );
};
