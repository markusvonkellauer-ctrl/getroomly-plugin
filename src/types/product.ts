/**
 * Product Types
 *
 * Core product interfaces for the GetRoomly embed
 */

export interface ProductMeasurements {
  width: number;
  depth: number;
  height: number;
}

export interface FurnitureItem {
  id: string;
  name: string;
  category: string;
  price?: number;
  images: string[];
  measurements?: ProductMeasurements;
  description?: string;
  material?: string;
}

// Legacy alias for backwards compatibility
export type Product = FurnitureItem;

export interface PlacementCoordinates {
  x: number;
  y: number;
  percentageX: number;
  percentageY: number;
}

export interface GenerationResult {
  imageUrl: string;
  base64Data: string;
  prompt: string;
  latency: number;
  coordinates?: PlacementCoordinates;
}