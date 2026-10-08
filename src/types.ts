export type UserRole = 'resident' | 'collector' | 'admin';

export interface UserAccountRecord {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  residentId?: string;
  collectorId?: string;
  phone?: string;
  createdAt?: any;
}

export interface ResidentRecord {
  residentId: string;
  householdId: string;
  name: string;
  address: string;
  area: string;
  city: string;
  pin: string;
  phone: string;
  rewardPoints: number;
  collectionsCount?: number;
  role: 'resident';
  ownerUid: string;
  eligibleForAdminReview?: boolean;
  createdAt?: any;
}

export interface CollectorRecord {
  collectorId: string;
  name: string;
  vehicleId: string;
  assignedArea: string;
  phone: string;
  role: 'collector';
  ownerUid: string;
  latitude?: number;
  longitude?: number;
  gpsActive?: boolean;
  updatedAt?: any;
  createdAt?: any;
}

export interface SelectedResident {
  residentId: string;
  householdId: string;
  token: string;
  name: string;
  address: string;
  area: string;
  city: string;
  pinCode: string;
  pin?: string;
  phone?: string;
  role?: 'resident';
  rewardPoints?: number;
  collectionsCount?: number;
  eligibleForAdminReview?: boolean;
  ownerUid?: string;
}

export const ALLOWED_AI_RESULTS = [
  'WET_WASTE',
  'DRY_WASTE',
  'PLASTIC',
  'POLYTHENE',
  'PAPER',
  'CARDBOARD',
  'METAL',
  'ALUMINIUM',
  'GLASS',
  'E_WASTE',
  'ORGANIC_WASTE',
  'OTHER',
  'NOT_WASTE',
  'HUMAN_DETECTED',
] as const;

export type AIResultEnum = (typeof ALLOWED_AI_RESULTS)[number];

export type SavableWasteCategory =
  | 'WET_WASTE'
  | 'DRY_WASTE'
  | 'PLASTIC'
  | 'POLYTHENE'
  | 'PAPER'
  | 'CARDBOARD'
  | 'METAL'
  | 'ALUMINIUM'
  | 'GLASS'
  | 'E_WASTE'
  | 'ORGANIC_WASTE'
  | 'OTHER';

export const WASTE_CATEGORY_LABELS: Record<AIResultEnum, string> = {
  WET_WASTE: 'Wet Waste',
  DRY_WASTE: 'Dry Waste',
  PLASTIC: 'Plastic',
  POLYTHENE: 'Polythene',
  PAPER: 'Paper',
  CARDBOARD: 'Cardboard',
  METAL: 'Metal',
  ALUMINIUM: 'Aluminium',
  GLASS: 'Glass',
  E_WASTE: 'E-Waste',
  ORGANIC_WASTE: 'Organic Waste',
  OTHER: 'Other',
  NOT_WASTE: 'Not Waste',
  HUMAN_DETECTED: 'Human Detected',
};

export const WASTE_REWARD_POINTS: Record<SavableWasteCategory, number> = {
  WET_WASTE: 15,
  ORGANIC_WASTE: 20,
  DRY_WASTE: 15,
  PLASTIC: 25,
  POLYTHENE: 10,
  PAPER: 20,
  CARDBOARD: 20,
  METAL: 30,
  ALUMINIUM: 30,
  GLASS: 25,
  E_WASTE: 50,
  OTHER: 10,
};

export type AnalysisStatusState =
  | 'IDLE'
  | 'ANALYZING'
  | 'RETRYING'
  | 'SUCCESS'
  | 'AI_ANALYSIS_FAILED'
  | 'HUMAN_DETECTED'
  | 'NOT_WASTE'
  | 'LOW_CONFIDENCE';

export interface GarbageAnalysisResponse {
  success?: boolean;
  wasteType?: string;
  result: AIResultEnum;
  object: string;
  confidence: number; // 0.00 to 1.00
  humanDetected: boolean;
  garbageDetected?: boolean;
  isGarbage: boolean;
  message?: string;
  reason: string;
}

export interface GarbageCollectionRecord {
  collectionId: string;
  residentId: string;
  householdId: string;
  residentName: string;
  address: string;
  area: string;
  city: string;
  pinCode: string;
  collectorId: string;
  collectorUid: string;
  collectorName: string;
  vehicleId: string;
  vehicleNumber: string;
  wasteType: string;
  wasteCategory: SavableWasteCategory;
  detectedObject: string;
  confidence: number; // 0 to 100
  reason: string;
  imageUrl: string;
  latitude: number;
  longitude: number;
  gpsLocation: string;
  timestamp: any;
  createdAt: any;
  rewardPoints: number;
  rewardPointsEarned: number;
  status: 'VERIFIED';
}

export interface GovernmentIncentiveProgram {
  incentiveId: string;
  programName: string;
  eligibility: string;
  rewardAmount: string;
  startDate: string;
  endDate: string;
  status: 'ACTIVE' | 'UPCOMING' | 'PAUSED' | 'CLOSED';
  notes: string;
  supportingDocuments: string;
  createdByUid: string;
  createdAt: any;
}
