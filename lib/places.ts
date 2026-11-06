// Shared contract for the place-suggestion endpoint and the typeahead UI.

export type PlaceSuggestion = {
  id: string;
  name: string;
  label: string;
  kind: "city" | "airport";
  country: string | null;
  countryCode: string | null;
  admin1: string | null;
  latitude: number;
  longitude: number;
  population: number | null;
};
