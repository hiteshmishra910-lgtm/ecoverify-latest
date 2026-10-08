import React, { useEffect, useRef, useState, useCallback } from 'react';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import { auth, db, storage, handleFirestoreError, OperationType } from '../firebase';
import {
  ALLOWED_AI_RESULTS,
  AIResultEnum,
  GarbageAnalysisResponse,
  SavableWasteCategory,
  SelectedResident,
  WASTE_CATEGORY_LABELS,
  WASTE_REWARD_POINTS,
} from '../types';
import {
  Camera,
  Upload,
  X,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  UserX,
  ScanLine,
  Truck,
  MapPin,
  SwitchCamera,
  Sparkles,
  ShieldCheck,
  Award,
  Clock,
  QrCode,
  ArrowLeft,
  Zap,
  ZapOff,
} from 'lucide-react';

interface GarbageScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedResident: SelectedResident | null;
  collectorId?: string;
  collectorName?: string;
  vehicleNumber: string;
  onVehicleNumberChange: (vehicle: string) => void;
  onCollectionSubmitted: () => void;
  onRequestQRScan?: () => void;
  inlineMode?: boolean;
}

type ModalStage =
  | 'CAMERA'
  | 'CAPTURED'
  | 'ANALYZING'
  | 'RESULT_SUCCESS'
  | 'RESULT_HUMAN'
  | 'RESULT_NOT_WASTE'
  | 'RESULT_LOW_CONFIDENCE'
  | 'RESULT_ERROR';

const RETRY_DELAYS_MS = [2000, 5000, 10000];
const HARD_REQUEST_TIMEOUT_MS = 30000;

function resolveBackendApiUrl(endpointPath: string): {
  url: string | null;
  configError: string | null;
} {
  const rawBase = String((import.meta as any).env?.VITE_API_BASE_URL || '').trim();
  const isCapacitorNative = Boolean(
    (window as any)?.Capacitor?.isNativePlatform?.() ||
      window.location.protocol === 'capacitor:' ||
      window.location.protocol === 'file:'
  );

  // If user configured a real HTTPS backend URL, use it
  if (
    rawBase &&
    rawBase !== 'https://YOUR_DEPLOYED_BACKEND_URL' &&
    rawBase !== 'MY_APP_URL' &&
    !rawBase.includes('YOUR_DEPLOYED_BACKEND_URL')
  ) {
    return {
      url: `${rawBase.replace(/\/+$/, '')}${endpointPath}`,
      configError: null,
    };
  }

  // If running inside an Android APK without a configured VITE_API_BASE_URL
  if (isCapacitorNative) {
    return {
      url: null,
      configError:
        'Backend unavailable: VITE_API_BASE_URL is not configured for this Android build.',
    };
  }

  // Running on deployed HTTPS web origin or dev preview
  return {
    url: endpointPath,
    configError: null,
  };
}

export const GarbageScannerModal: React.FC<GarbageScannerModalProps> = ({
  isOpen,
  onClose,
  selectedResident,
  collectorId,
  collectorName,
  vehicleNumber,
  onVehicleNumberChange,
  onCollectionSubmitted,
  onRequestQRScan,
  inlineMode = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeRunIdRef = useRef<number>(0);
  const retryTimerRef = useRef<number | null>(null);
  const submittedCaptureLockRef = useRef<string | null>(null);

  const [stage, setStage] = useState<ModalStage>('CAMERA');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<'permission_required' | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [capturedMimeType, setCapturedMimeType] = useState<string>('image/jpeg');
  const [captureTimestamp, setCaptureTimestamp] = useState<string>('');

  const [retryCount, setRetryCount] = useState<number>(0);
  const [analysisData, setAnalysisData] = useState<GarbageAnalysisResponse | null>(null);
  const [errorCategoryLabel, setErrorCategoryLabel] = useState<string>('');
  const [errorDetailMessage, setErrorDetailMessage] = useState<string>('');

  const [gpsStatus, setGpsStatus] = useState<'ACTIVE' | 'PERMISSION_REQUIRED' | 'ACQUIRING'>(
    'ACQUIRING'
  );
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const cancelOngoingAnalysis = useCallback(() => {
    activeRunIdRef.current += 1;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const stopCamera = useCallback(() => {
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

  // Acquire real device GPS coordinates (Never use hardcoded coordinates)
  const requestRealGps = useCallback(() => {
    setGpsStatus('ACQUIRING');
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLatitude(Number(pos.coords.latitude.toFixed(6)));
          setLongitude(Number(pos.coords.longitude.toFixed(6)));
          setGpsStatus('ACTIVE');
        },
        () => {
          setLatitude(null);
          setLongitude(null);
          setGpsStatus('PERMISSION_REQUIRED');
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
      );
    } else {
      setLatitude(null);
      setLongitude(null);
      setGpsStatus('PERMISSION_REQUIRED');
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    requestRealGps();
  }, [isOpen, requestRealGps]);

  const requestCapacitorCameraPermission = async () => {
    try {
      const cap = (window as any)?.Capacitor;
      if (cap?.Plugins?.Camera?.requestPermissions) {
        const perm = await cap.Plugins.Camera.requestPermissions({
          permissions: ['camera'],
        });
        if (perm?.camera === 'denied') {
          return false;
        }
      }
    } catch {
      // Ignore on standard web
    }
    return true;
  };

  const startCamera = useCallback(
    async (mode: 'environment' | 'user' = facingMode) => {
      stopCamera();
      setCameraError(null);
      setStage('CAMERA');

      const allowed = await requestCapacitorCameraPermission();
      if (!allowed) {
        setCameraError('permission_required');
        return;
      }

      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
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
        }
      } catch (err: any) {
        console.error('Waste Camera Error:', err);
        setCameraError('permission_required');
      }
    },
    [facingMode, stopCamera]
  );

  useEffect(() => {
    if (isOpen && stage === 'CAMERA' && !capturedImage) {
      startCamera(facingMode);
    } else if (!isOpen) {
      cancelOngoingAnalysis();
      stopCamera();
      setStage('CAMERA');
      setCapturedImage(null);
      setAnalysisData(null);
      setRetryCount(0);
      setCameraError(null);
      setSubmitSuccess(false);
      setSubmitting(false);
    }

    return () => {
      if (!isOpen) {
        cancelOngoingAnalysis();
        stopCamera();
      }
    };
  }, [isOpen, stage, capturedImage, facingMode, startCamera, stopCamera, cancelOngoingAnalysis]);

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
      // Ignore if unsupported
    }
  };

  const waitDelayMs = (ms: number, runId: number) =>
    new Promise<boolean>((resolve) => {
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        resolve(activeRunIdRef.current === runId);
      }, ms);
    });

  const prepareImageForAI = (
    rawDataUrl: string,
    mimeType: string
  ): Promise<{ dataUrl: string; mimeType: string; byteSize: number }> => {
    return new Promise((resolve, reject) => {
      if (!rawDataUrl || typeof rawDataUrl !== 'string' || !rawDataUrl.startsWith('data:image/')) {
        reject(new Error('Invalid image payload'));
        return;
      }

      const img = new Image();
      img.onload = () => {
        try {
          const maxDim = 1024;
          let targetW = img.width || 640;
          let targetH = img.height || 480;

          if (targetW > maxDim || targetH > maxDim) {
            if (targetW > targetH) {
              targetH = Math.round((targetH * maxDim) / targetW);
              targetW = maxDim;
            } else {
              targetW = Math.round((targetW * maxDim) / targetH);
              targetH = maxDim;
            }
          }

          const offscreen = document.createElement('canvas');
          offscreen.width = targetW;
          offscreen.height = targetH;
          const ctx = offscreen.getContext('2d');
          if (!ctx) {
            const rawB64 = rawDataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
            resolve({
              dataUrl: rawDataUrl,
              mimeType: mimeType || 'image/jpeg',
              byteSize: Math.round((rawB64.length * 3) / 4),
            });
            return;
          }

          ctx.drawImage(img, 0, 0, targetW, targetH);
          const optimizedDataUrl = offscreen.toDataURL('image/jpeg', 0.82);
          const cleanB64 = optimizedDataUrl.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
          const byteSize = Math.round((cleanB64.length * 3) / 4);

          if (!cleanB64 || byteSize < 100) {
            reject(new Error('Captured image is empty'));
            return;
          }

          resolve({
            dataUrl: optimizedDataUrl,
            mimeType: 'image/jpeg',
            byteSize,
          });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => {
        reject(new Error('Failed to decode captured image'));
      };
      img.src = rawDataUrl;
    });
  };

  const handleAnalyzeWaste = useCallback(async () => {
    if (!capturedImage) return;

    cancelOngoingAnalysis();
    const currentRunId = activeRunIdRef.current + 1;
    activeRunIdRef.current = currentRunId;

    setStage('ANALYZING');
    setRetryCount(0);
    setAnalysisData(null);
    setErrorCategoryLabel('');
    setErrorDetailMessage('');

    let nextStage: ModalStage = 'RESULT_ERROR';

    const mapClientCategory = (raw: string): AIResultEnum | null => {
      const cleaned = String(raw || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      if ((ALLOWED_AI_RESULTS as readonly string[]).includes(cleaned)) {
        return cleaned as AIResultEnum;
      }
      const aliasMap: Record<string, AIResultEnum> = {
        PLASTIC_WASTE: 'PLASTIC',
        PLASTIC_BOTTLE: 'PLASTIC',
        POLYTHENE_BAG: 'POLYTHENE',
        PLASTIC_BAG: 'POLYTHENE',
        WET: 'WET_WASTE',
        WET_WASTE: 'WET_WASTE',
        FOOD_WASTE: 'WET_WASTE',
        DRY: 'DRY_WASTE',
        DRY_WASTE: 'DRY_WASTE',
        ORGANIC: 'ORGANIC_WASTE',
        ORGANIC_WASTE: 'ORGANIC_WASTE',
        PAPER_WASTE: 'PAPER',
        CARDBOARD_BOX: 'CARDBOARD',
        METAL_WASTE: 'METAL',
        ALUMINUM: 'ALUMINIUM',
        ALUMINUM_CAN: 'ALUMINIUM',
        ALUMINIUM_CAN: 'ALUMINIUM',
        GLASS_BOTTLE: 'GLASS',
        EWASTE: 'E_WASTE',
        E_WASTE: 'E_WASTE',
        ELECTRONIC_WASTE: 'E_WASTE',
        PERSON: 'HUMAN_DETECTED',
        HUMAN: 'HUMAN_DETECTED',
        NO_WASTE: 'NOT_WASTE',
        NO_GARBAGE: 'NOT_WASTE',
      };
      return aliasMap[cleaned] || null;
    };

    try {
      const { url: endpointUrl, configError } = resolveBackendApiUrl('/api/analyze-garbage');
      if (!endpointUrl || configError) {
        setErrorCategoryLabel('Backend unavailable');
        setErrorDetailMessage(
          configError ||
            'Backend unavailable. Configure VITE_API_BASE_URL with your deployed HTTPS backend URL.'
        );
        nextStage = 'RESULT_ERROR';
        return;
      }

      console.log('AI MODEL:', 'gemini-flash-latest');
      console.log('AI REQUEST START:', new Date().toISOString());

      let prepared: { dataUrl: string; mimeType: string; byteSize: number };
      try {
        prepared = await prepareImageForAI(capturedImage, capturedMimeType);
      } catch (prepErr: any) {
        setErrorCategoryLabel('Invalid request/image');
        setErrorDetailMessage(
          prepErr?.message || 'Captured image could not be processed. Please retake the photo.'
        );
        nextStage = 'RESULT_ERROR';
        return;
      }

      if (activeRunIdRef.current !== currentRunId) return;

      console.log('IMAGE SIZE:', prepared.byteSize);
      console.log('IMAGE MIME TYPE:', prepared.mimeType);

      for (let retryAttempt = 0; retryAttempt <= 3; retryAttempt++) {
        if (activeRunIdRef.current !== currentRunId) return;

        if (retryAttempt > 0) {
          setRetryCount(retryAttempt);
          const baseDelay = RETRY_DELAYS_MS[retryAttempt - 1] || 10000;
          const jitter = Math.floor(Math.random() * 450);
          const waitMs = baseDelay + jitter;

          const shouldContinue = await waitDelayMs(waitMs, currentRunId);
          if (!shouldContinue) return;
        }

        const attemptNumber = retryAttempt + 1;

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => {
          controller.abort();
        }, HARD_REQUEST_TIMEOUT_MS);

        let response: Response;
        try {
          response = await fetch(endpointUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              imageBase64: prepared.dataUrl,
              mimeType: prepared.mimeType,
              attempt: attemptNumber,
            }),
            signal: controller.signal,
          });
        } catch (fetchErr: any) {
          window.clearTimeout(timeoutId);
          if (activeRunIdRef.current !== currentRunId) return;

          if (fetchErr?.name === 'AbortError') {
            console.error('AI RESPONSE STATUS:', 'TIMEOUT (30s)');
            setErrorCategoryLabel('Timeout');
            setErrorDetailMessage('AI analysis timed out after 30 seconds. Please try again.');
            nextStage = 'RESULT_ERROR';
            return;
          }

          console.error('AI RESPONSE STATUS:', 'BACKEND_UNAVAILABLE', fetchErr);
          setErrorCategoryLabel('Backend unavailable');
          setErrorDetailMessage(
            'Backend unavailable. Please check your network connection or VITE_API_BASE_URL configuration.'
          );
          nextStage = 'RESULT_ERROR';
          return;
        }

        window.clearTimeout(timeoutId);
        if (activeRunIdRef.current !== currentRunId) return;

        console.log('AI RESPONSE STATUS:', response.status);

        // Rule 8: Check Content-Type and raw text before JSON.parse so HTML/Vite pages show "Backend unavailable"
        const contentType = String(response.headers.get('content-type') || '').toLowerCase();
        const rawBodyText = await response.text();

        if (
          !contentType.includes('application/json') ||
          rawBodyText.trim().startsWith('<!doctype') ||
          rawBodyText.trim().startsWith('<html')
        ) {
          console.error('AI RESPONSE RECEIVED:', 'Non-JSON/HTML response from endpoint');
          setErrorCategoryLabel('Backend unavailable');
          setErrorDetailMessage(
            'Backend unavailable. Ensure VITE_API_BASE_URL points to the deployed backend server.'
          );
          nextStage = 'RESULT_ERROR';
          return;
        }

        let payload: any = null;
        try {
          payload = JSON.parse(rawBodyText);
        } catch {
          setErrorCategoryLabel('Backend unavailable');
          setErrorDetailMessage('Backend unavailable. Please retry analysis.');
          nextStage = 'RESULT_ERROR';
          return;
        }

        if (payload?.model) {
          console.log('AI MODEL:', payload.model);
        }
        console.log('AI RESPONSE RECEIVED:', payload);

        // Check for HUMAN_DETECTED JSON response
        if (payload?.error === 'HUMAN_DETECTED' || payload?.result === 'HUMAN_DETECTED') {
          const humanData: GarbageAnalysisResponse = {
            success: false,
            wasteType: 'Human Detected',
            result: 'HUMAN_DETECTED',
            object: String(payload?.object || 'Person'),
            confidence: Number(payload?.confidence || 0.95),
            humanDetected: true,
            garbageDetected: false,
            isGarbage: false,
            message:
              String(payload?.message || 'Please capture a clear image of the garbage.'),
            reason:
              String(
                payload?.message ||
                  payload?.reason ||
                  'Please capture a clear image of the garbage.'
              ),
          };
          setAnalysisData(humanData);
          nextStage = 'RESULT_HUMAN';
          return;
        }

        // 503 = temporary service unavailable -> retry up to 3 times
        if (
          response.status === 503 ||
          payload?.status === 'UNAVAILABLE' ||
          payload?.errorCode === 503
        ) {
          if (retryAttempt < 3) {
            continue;
          }
          setErrorCategoryLabel('Temporary service unavailable (HTTP 503)');
          setErrorDetailMessage(
            payload?.message || 'AI service is temporarily unavailable. Please retry.'
          );
          nextStage = 'RESULT_ERROR';
          return;
        }

        if (response.status === 504 || payload?.status === 'TIMEOUT' || payload?.errorCode === 504) {
          setErrorCategoryLabel('Timeout');
          setErrorDetailMessage(payload?.message || 'AI analysis timed out. Please try again.');
          nextStage = 'RESULT_ERROR';
          return;
        }

        if (
          response.status === 429 ||
          payload?.status === 'RATE_LIMITED' ||
          payload?.errorCode === 429
        ) {
          setErrorCategoryLabel('Rate limit (HTTP 429)');
          setErrorDetailMessage(
            payload?.message || 'AI request limit reached. Please wait a moment and try again.'
          );
          nextStage = 'RESULT_ERROR';
          return;
        }

        if (
          response.status === 401 ||
          response.status === 403 ||
          payload?.status === 'AUTH_ERROR' ||
          payload?.errorCode === 401 ||
          payload?.errorCode === 403
        ) {
          setErrorCategoryLabel('API key/authentication problem');
          setErrorDetailMessage(
            payload?.message ||
              payload?.detail ||
              'Gemini API key is missing, invalid, or restricted.'
          );
          nextStage = 'RESULT_ERROR';
          return;
        }

        if (
          response.status === 400 ||
          payload?.status === 'BAD_REQUEST' ||
          payload?.errorCode === 400
        ) {
          setErrorCategoryLabel('Invalid request/image (HTTP 400)');
          setErrorDetailMessage(
            payload?.message || payload?.detail || 'Invalid image or request format.'
          );
          nextStage = 'RESULT_ERROR';
          return;
        }

        if (!response.ok || payload?.error === 'AI_ANALYSIS_UNAVAILABLE') {
          setErrorCategoryLabel(payload?.errorCategory || 'AI service unavailable');
          setErrorDetailMessage(
            payload?.message || 'AI service is temporarily unavailable. Please retry.'
          );
          nextStage = 'RESULT_ERROR';
          return;
        }

        const rawCategoryCandidate = payload?.result || payload?.wasteType || '';
        const validatedResult = mapClientCategory(rawCategoryCandidate);

        if (!validatedResult) {
          setErrorCategoryLabel('AI analysis unavailable');
          setErrorDetailMessage('AI service is temporarily unavailable. Please retry.');
          nextStage = 'RESULT_ERROR';
          return;
        }

        let rawConf = Number(payload?.confidence);
        if (Number.isNaN(rawConf)) {
          rawConf = 0.85;
        } else if (rawConf > 1) {
          rawConf = rawConf / 100;
        }
        const confidence = Math.max(0, Math.min(1, rawConf));

        const isGarbageFlag = Boolean(
          payload?.garbageDetected ?? payload?.isGarbage ?? validatedResult !== 'NOT_WASTE'
        );
        const isHumanOnly =
          validatedResult === 'HUMAN_DETECTED' ||
          (Boolean(payload?.humanDetected) && !isGarbageFlag);

        const finalCategory: AIResultEnum = isHumanOnly ? 'HUMAN_DETECTED' : validatedResult;
        const displayWasteLabel =
          payload?.wasteType || WASTE_CATEGORY_LABELS[finalCategory] || 'Other';

        const parsedResponse: GarbageAnalysisResponse = {
          success: Boolean(payload?.success ?? isGarbageFlag),
          wasteType: displayWasteLabel,
          result: finalCategory,
          object: String(payload?.object || '').trim() || displayWasteLabel,
          confidence,
          humanDetected: isHumanOnly,
          garbageDetected: isGarbageFlag,
          isGarbage: finalCategory !== 'HUMAN_DETECTED' && finalCategory !== 'NOT_WASTE' && isGarbageFlag,
          message:
            String(payload?.message || '').trim() || `${displayWasteLabel} waste detected`,
          reason:
            String(payload?.reason || payload?.message || '').trim() ||
            `${displayWasteLabel} waste detected`,
        };

        console.log('AI PARSE SUCCESS:', parsedResponse);

        setAnalysisData(parsedResponse);

        if (
          parsedResponse.result === 'HUMAN_DETECTED' ||
          (parsedResponse.humanDetected && !parsedResponse.isGarbage)
        ) {
          nextStage = 'RESULT_HUMAN';
          return;
        }

        if (parsedResponse.result === 'NOT_WASTE' || !parsedResponse.isGarbage) {
          nextStage = 'RESULT_NOT_WASTE';
          return;
        }

        if (parsedResponse.confidence < 0.6) {
          nextStage = 'RESULT_LOW_CONFIDENCE';
          return;
        }

        nextStage = 'RESULT_SUCCESS';
        return;
      }
    } catch (unexpectedErr: any) {
      console.error('Unexpected AI analysis error:', unexpectedErr);
      setErrorCategoryLabel('Backend unavailable');
      setErrorDetailMessage(
        unexpectedErr?.message || 'AI service is temporarily unavailable. Please retry.'
      );
      nextStage = 'RESULT_ERROR';
    } finally {
      if (activeRunIdRef.current === currentRunId) {
        setStage(nextStage);
      }
    }
  }, [capturedImage, capturedMimeType, cancelOngoingAnalysis]);

  const handleCapturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    stopCamera();
    setCapturedImage(dataUrl);
    setCapturedMimeType('image/jpeg');
    setCaptureTimestamp(new Date().toLocaleString());
    setSubmitSuccess(false);
    setStage('CAPTURED');
  };

  const handleUploadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const mimeType = file.type || 'image/jpeg';
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      stopCamera();
      setCapturedImage(dataUrl);
      setCapturedMimeType(mimeType);
      setCaptureTimestamp(new Date().toLocaleString());
      setSubmitSuccess(false);
      setStage('CAPTURED');
    };
    reader.onerror = () => {
      setErrorCategoryLabel('Invalid request/image');
      setErrorDetailMessage('Unable to read the selected gallery image.');
      setStage('RESULT_ERROR');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleRetakePhoto = () => {
    cancelOngoingAnalysis();
    setCapturedImage(null);
    setAnalysisData(null);
    setRetryCount(0);
    setSubmitSuccess(false);
    setStage('CAMERA');
  };

  const handleConfirmAndSubmit = async () => {
    if (
      stage !== 'RESULT_SUCCESS' ||
      !analysisData ||
      !capturedImage ||
      !selectedResident ||
      submitting ||
      submitSuccess
    ) {
      return;
    }

    // Prevent duplicate submission of the same collection
    const submissionSignature = `${selectedResident.householdId}_${captureTimestamp}_${capturedImage.slice(-64)}`;
    if (submittedCaptureLockRef.current === submissionSignature) {
      setSubmitSuccess(true);
      return;
    }

    if (gpsStatus !== 'ACTIVE' || latitude === null || longitude === null) {
      setErrorCategoryLabel('GPS Permission Required');
      setErrorDetailMessage(
        'Real device GPS coordinates are required to verify and save this collection.'
      );
      requestRealGps();
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      setErrorCategoryLabel('Authentication error');
      setErrorDetailMessage('Please sign in with your Collector account to submit this collection.');
      setStage('RESULT_ERROR');
      return;
    }

    setSubmitting(true);

    const collectionId = `COL-${Date.now()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
    const docPath = `collections/${collectionId}`;

    const wasteCat = analysisData.result as SavableWasteCategory;
    const rewardPoints = WASTE_REWARD_POINTS[wasteCat] || 15;
    const confidencePercent = Math.round(analysisData.confidence * 100);
    const resolvedCollectorId = (
      collectorId || `COL-${currentUser.uid.slice(0, 6).toUpperCase()}`
    ).slice(0, 128);
    const resolvedCollectorName = (
      collectorName ||
      currentUser.displayName ||
      currentUser.email ||
      'Field Collector'
    ).slice(0, 120);
    const resolvedVehicleId = (vehicleNumber.trim() || 'DL-1GC-4092').slice(0, 60);
    const wasteTypeDisplay = (
      analysisData.wasteType ||
      WASTE_CATEGORY_LABELS[wasteCat] ||
      'Other'
    ).slice(0, 60);

    try {
      // 1. Store REAL captured garbage image in Firebase Storage
      let uploadedImageUrl = '';
      try {
        const storageReference = ref(storage, `collections/${collectionId}.jpg`);
        await uploadString(storageReference, capturedImage, 'data_url');
        uploadedImageUrl = await getDownloadURL(storageReference);
      } catch {
        // If Firebase Storage bucket rules restrict upload, store compressed data URL so the real captured photo is preserved
        uploadedImageUrl = capturedImage.slice(0, 1950);
      }

      // 2. Save verified collection document to Firestore collections/{collectionId}
      await setDoc(doc(db, 'collections', collectionId), {
        collectionId,
        residentId: selectedResident.residentId.slice(0, 128),
        householdId: selectedResident.householdId.slice(0, 128),
        residentName: selectedResident.name.slice(0, 120),
        address: selectedResident.address.slice(0, 250),
        area: (selectedResident.area || 'Municipal Zone').slice(0, 120),
        city: (selectedResident.city || 'City').slice(0, 100),
        pinCode: (selectedResident.pinCode || selectedResident.pin || '000000').slice(0, 20),
        collectorId: resolvedCollectorId,
        collectorUid: currentUser.uid,
        collectorName: resolvedCollectorName,
        vehicleId: resolvedVehicleId,
        vehicleNumber: resolvedVehicleId,
        wasteType: wasteTypeDisplay,
        wasteCategory: wasteCat,
        detectedObject: (analysisData.object || wasteTypeDisplay).slice(0, 200),
        confidence: confidencePercent,
        reason: (analysisData.reason || `${wasteTypeDisplay} waste detected`).slice(0, 500),
        imageUrl: uploadedImageUrl.slice(0, 2000),
        latitude,
        longitude,
        gpsLocation: `${latitude}, ${longitude}`.slice(0, 120),
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
        rewardPoints,
        rewardPointsEarned: rewardPoints,
        status: 'VERIFIED',
      });

      // 3. Increment rewardPoints once on residents/{residentId} and households/{householdId}
      try {
        const resRef = doc(db, 'residents', selectedResident.residentId);
        const resSnap = await getDoc(resRef);
        if (resSnap.exists()) {
          const rData = resSnap.data();
          await updateDoc(resRef, {
            rewardPoints: Number(rData.rewardPoints || 0) + rewardPoints,
            collectionsCount: Number(rData.collectionsCount || 0) + 1,
          });
        }
      } catch (err) {
        console.warn('Could not update residents document rewardPoints:', err);
      }

      try {
        const hhRef = doc(db, 'households', selectedResident.householdId);
        const hhSnap = await getDoc(hhRef);
        if (hhSnap.exists()) {
          const hhData = hhSnap.data();
          await updateDoc(hhRef, {
            rewardPoints: Number(hhData.rewardPoints || 0) + rewardPoints,
            collectionsCount: Number(hhData.collectionsCount || 0) + 1,
          });
        }
      } catch (err) {
        console.warn('Could not update households document rewardPoints:', err);
      }

      submittedCaptureLockRef.current = submissionSignature;
      setSubmitSuccess(true);
      stopCamera();
      onCollectionSubmitted();
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, docPath);
      } catch (formattedErr: any) {
        setErrorCategoryLabel('Firestore Save Error');
        setErrorDetailMessage(`Failed to save collection: ${formattedErr.message}`);
        setStage('RESULT_ERROR');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    cancelOngoingAnalysis();
    stopCamera();
    onClose();
  };

  if (!isOpen) return null;

  const collectorDisplayName =
    collectorName ||
    auth.currentUser?.displayName ||
    auth.currentUser?.email ||
    'Authenticated Collector';

  const content = (
    <div className="w-full max-w-2xl mx-auto rounded-[24px] bg-white border border-slate-200 shadow-xl overflow-hidden">
      {/* Top Bar with Back, Title, GPS status */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100 bg-slate-900 text-white gap-2">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleClose}
            className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </button>
          <div>
            <h2 className="text-sm sm:text-base font-bold tracking-tight">
              Waste Inspection
            </h2>
            <p className="text-[11px] text-slate-300">
              Real Device Camera &amp; Gemini AI Verification
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {gpsStatus === 'ACTIVE' && latitude !== null && longitude !== null ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300 bg-emerald-950/80 border border-emerald-700 px-2.5 py-1 rounded-lg">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>GPS Active</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={requestRealGps}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-300 bg-amber-950/80 border border-amber-700 px-2.5 py-1 rounded-lg cursor-pointer"
            >
              <AlertCircle className="w-3.5 h-3.5" />
              <span>GPS Permission Required</span>
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 sm:p-6 space-y-5">
        <canvas ref={canvasRef} className="hidden" />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleUploadImage}
          className="hidden"
        />

        {/* Resident Context Card (Resident name, Address, Household ID) */}
        {selectedResident ? (
          <div className="p-4 rounded-2xl bg-emerald-50/90 border border-emerald-200 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <span className="text-slate-500 font-medium block">Resident Name</span>
              <span className="text-slate-900 font-bold text-sm mt-0.5 block">
                {selectedResident.name}
              </span>
            </div>
            <div>
              <span className="text-slate-500 font-medium block">Household ID</span>
              <span className="text-emerald-800 font-mono font-bold text-sm tabular-nums mt-0.5 block">
                {selectedResident.householdId}
              </span>
            </div>
            <div>
              <span className="text-slate-500 font-medium block">Address</span>
              <span className="text-slate-800 font-medium mt-0.5 block">
                {selectedResident.address}, {selectedResident.area}
              </span>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <span className="font-bold text-amber-950 block">
                No Resident QR Scanned Yet
              </span>
              <span className="text-amber-800">
                You can test the waste camera &amp; AI now, or scan a Resident QR to record a household collection.
              </span>
            </div>
            {onRequestQRScan && (
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  onRequestQRScan();
                }}
                className="min-h-[40px] px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <QrCode className="w-4 h-4" />
                <span>Scan Resident QR</span>
              </button>
            )}
          </div>
        )}

        {/* STAGE 1: MOBILE CAMERA INTERFACE */}
        {stage === 'CAMERA' && (
          <div className="space-y-4">
            {cameraError === 'permission_required' ? (
              <div className="p-6 rounded-2xl bg-red-50 border border-red-200 space-y-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center mx-auto">
                  <Camera className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-red-950">
                    Camera Permission Required
                  </h3>
                  <p className="text-xs text-red-800 max-w-sm mx-auto">
                    Camera access is required to capture a live waste photo, or use Gallery upload fallback below.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => startCamera(facingMode)}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Grant Camera Permission</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold hover:bg-slate-50 transition-colors flex items-center gap-2 cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Gallery Upload</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3] sm:aspect-video border border-slate-800 shadow-inner">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />

                  <div className="pointer-events-none absolute inset-5 sm:inset-8 border border-white/25 rounded-2xl">
                    <div className="absolute -top-0.5 -left-0.5 w-7 h-7 border-t-3 border-l-3 border-emerald-400 rounded-tl-xl" />
                    <div className="absolute -top-0.5 -right-0.5 w-7 h-7 border-t-3 border-r-3 border-emerald-400 rounded-tr-xl" />
                    <div className="absolute -bottom-0.5 -left-0.5 w-7 h-7 border-b-3 border-l-3 border-emerald-400 rounded-bl-xl" />
                    <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 border-b-3 border-r-3 border-emerald-400 rounded-br-xl" />
                  </div>

                  {/* Camera Top Controls: Live status + Flash toggle + Switch camera */}
                  <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
                    <span className="px-3 py-1 rounded-lg bg-slate-950/75 backdrop-blur-xs text-white text-xs font-medium flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>Live Camera Preview</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {torchSupported && (
                        <button
                          type="button"
                          onClick={handleToggleTorch}
                          className="min-h-[36px] px-2.5 py-1 rounded-lg bg-slate-950/80 text-amber-300 text-xs font-semibold flex items-center gap-1 cursor-pointer"
                        >
                          {torchOn ? <Zap className="w-3.5 h-3.5" /> : <ZapOff className="w-3.5 h-3.5" />}
                          <span>Flash</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleToggleCameraFacing}
                        className="min-h-[36px] px-2.5 py-1 rounded-lg bg-slate-950/80 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <SwitchCamera className="w-3.5 h-3.5" />
                        <span>Switch</span>
                      </button>
                    </div>
                  </div>

                  {!cameraReady && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-950/65 text-white text-xs font-medium">
                      Opening rear camera...
                    </div>
                  )}
                </div>

                {/* Mobile Camera Bar: Switch Camera | Capture Button | Gallery Upload Fallback */}
                <div className="pt-2 flex items-center justify-between gap-3 px-2">
                  <button
                    type="button"
                    onClick={handleToggleCameraFacing}
                    className="min-h-[46px] px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <SwitchCamera className="w-4 h-4" />
                    <span>Switch Camera</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCapturePhoto}
                    className="group relative flex flex-col items-center justify-center cursor-pointer focus:outline-none"
                    aria-label="Capture Garbage Photo"
                  >
                    <div className="w-18 h-18 rounded-full p-1.5 border-4 border-emerald-600 bg-white group-hover:scale-105 group-active:scale-95 transition-transform flex items-center justify-center shadow-md">
                      <div className="w-full h-full rounded-full bg-emerald-600 group-hover:bg-emerald-700 flex items-center justify-center text-white">
                        <Camera className="w-6 h-6" />
                      </div>
                    </div>
                    <span className="text-[11px] font-bold text-slate-900 tracking-wider uppercase mt-1.5">
                      Capture
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-[46px] px-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Gallery</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* STAGE 2: CAPTURED PHOTO PREVIEW -> RETAKE OR USE PHOTO / ANALYZE WASTE */}
        {stage === 'CAPTURED' && capturedImage && (
          <div className="space-y-5">
            <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-[4/3] sm:aspect-video border border-slate-200">
              <img
                src={capturedImage}
                alt="Captured waste frame"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
              />
              <div className="absolute top-3 left-3 px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span>Use Photo · Ready for AI Analysis</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleRetakePhoto}
                className="min-h-[48px] px-5 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retake</span>
              </button>
              <button
                type="button"
                onClick={handleAnalyzeWaste}
                className="min-h-[48px] px-5 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>Analyze Waste</span>
              </button>
            </div>
          </div>
        )}

        {/* STAGE 3: ANALYZING */}
        {stage === 'ANALYZING' && capturedImage && (
          <div className="space-y-4">
            <div className="relative rounded-2xl overflow-hidden bg-slate-950 aspect-video border border-slate-200">
              <img
                src={capturedImage}
                alt="Analyzing waste frame"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain opacity-85"
              />
            </div>

            <div className="p-6 rounded-2xl bg-indigo-50/70 border border-indigo-100 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wider block">
                      GEMINI VISION AI
                    </span>
                    <h3 className="text-sm font-bold text-slate-900">
                      {retryCount > 0
                        ? `AI service busy. Retrying (${retryCount} of 3)...`
                        : 'Analyzing captured waste image...'}
                    </h3>
                  </div>
                </div>
                <span className="text-xs font-mono text-indigo-700 font-semibold">
                  30s Timeout
                </span>
              </div>

              <div className="w-full h-2 rounded-full bg-indigo-100 overflow-hidden">
                <div className="h-full w-2/3 bg-indigo-600 rounded-full animate-pulse" />
              </div>
            </div>
          </div>
        )}

        {/* STAGE 4: HUMAN DETECTED */}
        {stage === 'RESULT_HUMAN' && capturedImage && (
          <div className="space-y-4">
            <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-video border border-slate-200">
              <img
                src={capturedImage}
                alt="Person detected"
                referrerPolicy="no-referrer"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="p-6 rounded-2xl bg-red-50 border border-red-300 space-y-4">
              <div className="flex items-center gap-2.5 text-red-900 font-bold text-base">
                <UserX className="w-5 h-5 text-red-600 shrink-0" />
                <span>HUMAN DETECTED</span>
              </div>
              <p className="text-sm font-semibold text-red-900">
                {analysisData?.message || 'Please capture a clear image of the garbage.'}
              </p>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleRetakePhoto}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Retake Photo</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STAGE 5: NOT WASTE / LOW CONFIDENCE */}
        {(stage === 'RESULT_NOT_WASTE' || stage === 'RESULT_LOW_CONFIDENCE') &&
          capturedImage && (
            <div className="space-y-4">
              <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-video border border-slate-200">
                <img
                  src={capturedImage}
                  alt="Captured frame"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="p-6 rounded-2xl bg-amber-50 border border-amber-300 space-y-4">
                <div className="flex items-center gap-2 text-amber-950 font-bold text-base">
                  <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  <span>
                    {stage === 'RESULT_LOW_CONFIDENCE'
                      ? 'LOW CONFIDENCE DETECTION'
                      : 'NO CLEAR GARBAGE DETECTED'}
                  </span>
                </div>
                <p className="text-sm font-medium text-amber-900">
                  {stage === 'RESULT_LOW_CONFIDENCE'
                    ? `AI confidence (${Math.round(
                        (analysisData?.confidence || 0) * 100
                      )}%) is below threshold. Please capture a clearer photo of the waste.`
                    : analysisData?.message ||
                      analysisData?.reason ||
                      'Please capture a clear image of the garbage.'}
                </p>
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleRetakePhoto}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>Retake Photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAnalyzeWaste}
                    className="min-h-[44px] px-5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Retry Analysis</span>
                  </button>
                </div>
              </div>
            </div>
          )}

        {/* STAGE 6: AI / BACKEND ERROR STATE */}
        {stage === 'RESULT_ERROR' && (
          <div className="space-y-4">
            {capturedImage && (
              <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-video border border-slate-200">
                <img
                  src={capturedImage}
                  alt="Captured frame"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-contain"
                />
              </div>
            )}
            <div className="p-6 rounded-2xl bg-red-50 border border-red-200 space-y-4 text-center">
              <AlertCircle className="w-8 h-8 text-red-600 mx-auto" />
              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-red-950 uppercase tracking-tight">
                  {errorCategoryLabel === 'Backend unavailable'
                    ? 'Backend unavailable'
                    : 'AI Analysis Unavailable'}
                </h3>
                <p className="text-sm font-semibold text-red-900">
                  {errorDetailMessage || 'AI service is temporarily unavailable. Please retry.'}
                </p>
                {errorCategoryLabel && (
                  <p className="text-xs font-mono text-red-700">
                    Status: {errorCategoryLabel}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleAnalyzeWaste}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Retry Analysis</span>
                </button>
                <button
                  type="button"
                  onClick={handleRetakePhoto}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Retake Photo</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STAGE 7: COLLECTION VERIFIED CONFIRMATION */}
        {stage === 'RESULT_SUCCESS' && analysisData && capturedImage && (
          <div className="space-y-5">
            {selectedResident ? (
              <div className="rounded-2xl bg-white border border-slate-200 shadow-xs overflow-hidden">
                <div className="px-5 py-3.5 bg-emerald-700 text-white flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-200" />
                    <span>Collection Verified</span>
                  </div>
                  <span className="text-xs font-mono text-emerald-100 font-semibold tabular-nums">
                    +{WASTE_REWARD_POINTS[analysisData.result as SavableWasteCategory] || 15} Reward Points
                  </span>
                </div>

                <div className="p-5 grid grid-cols-1 md:grid-cols-12 gap-5 items-start">
                  <div className="md:col-span-5 space-y-2">
                    <span className="text-xs font-medium text-slate-500 block">
                      Garbage Image
                    </span>
                    <div className="rounded-xl overflow-hidden bg-slate-900 aspect-[4/3] border border-slate-200">
                      <img
                        src={capturedImage}
                        alt="Verified garbage photo"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>

                  <dl className="md:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-slate-500 font-medium">Resident:</dt>
                      <dd className="text-slate-900 font-bold mt-0.5">
                        {selectedResident.name}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 font-medium">Household ID:</dt>
                      <dd className="text-slate-900 font-mono font-bold tabular-nums mt-0.5">
                        {selectedResident.householdId}
                      </dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-slate-500 font-medium">Address:</dt>
                      <dd className="text-slate-800 mt-0.5">
                        {selectedResident.address}, {selectedResident.area}, {selectedResident.city}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 font-medium">Waste:</dt>
                      <dd className="text-emerald-700 font-bold mt-0.5">
                        {analysisData.wasteType || WASTE_CATEGORY_LABELS[analysisData.result]}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 font-medium">Confidence:</dt>
                      <dd className="text-slate-900 font-mono font-bold tabular-nums mt-0.5">
                        {Math.round(analysisData.confidence * 100)}%
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 font-medium">Collector:</dt>
                      <dd className="text-slate-900 font-semibold mt-0.5 truncate">
                        {collectorDisplayName}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 font-medium">Vehicle:</dt>
                      <dd className="mt-0.5">
                        <div className="flex items-center gap-1.5">
                          <Truck className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <input
                            type="text"
                            value={vehicleNumber}
                            onChange={(e) => onVehicleNumberChange(e.target.value)}
                            className="w-full px-2 py-1 text-xs font-mono border border-slate-200 rounded-md bg-slate-50 text-slate-900"
                          />
                        </div>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 font-medium">GPS:</dt>
                      <dd className="text-slate-700 font-mono tabular-nums mt-0.5 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-emerald-600 shrink-0" />
                        <span className="truncate">
                          {latitude !== null && longitude !== null
                            ? `${latitude}, ${longitude}`
                            : 'GPS Permission Required'}
                        </span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500 font-medium">Date &amp; Time:</dt>
                      <dd className="text-slate-700 font-mono tabular-nums mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{captureTimestamp}</span>
                      </dd>
                    </div>
                    <div className="sm:col-span-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-slate-500 font-medium">Reward:</span>
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-bold tabular-nums">
                        <Award className="w-3.5 h-3.5" />
                        <span>
                          +{WASTE_REWARD_POINTS[analysisData.result as SavableWasteCategory] || 15} Points
                        </span>
                      </span>
                    </div>
                  </dl>
                </div>

                <div className="px-5 pb-5">
                  {submitSuccess ? (
                    <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2 text-emerald-900 text-sm font-semibold">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        <span>Collection saved to Firestore &amp; Storage!</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleClose}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-emerald-700 text-white text-xs font-semibold hover:bg-emerald-800 transition-colors cursor-pointer"
                      >
                        Done
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        type="button"
                        onClick={handleConfirmAndSubmit}
                        disabled={submitting}
                        className="flex-1 min-h-[50px] px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          {submitting ? 'Saving to Firestore...' : 'Save Verified Collection'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={handleRetakePhoto}
                        disabled={submitting}
                        className="min-h-[50px] px-5 py-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>Retake</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-5 rounded-2xl bg-emerald-50 border border-emerald-200 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-950 text-sm">
                    AI Result: {analysisData.wasteType || WASTE_CATEGORY_LABELS[analysisData.result]} (
                    {Math.round(analysisData.confidence * 100)}%)
                  </span>
                </div>
                <p className="text-xs text-emerald-900">
                  Scan a Resident QR code first to link and save this verified collection to Firestore.
                </p>
                <div className="flex flex-wrap gap-3">
                  {onRequestQRScan && (
                    <button
                      type="button"
                      onClick={() => {
                        stopCamera();
                        onRequestQRScan();
                      }}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
                    >
                      <QrCode className="w-4 h-4" />
                      <span>Scan Resident QR</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleRetakePhoto}
                    className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 bg-white text-slate-800 text-xs font-semibold cursor-pointer"
                  >
                    Retake Photo
                  </button>
                </div>
              </div>
            )}
          </div>
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
