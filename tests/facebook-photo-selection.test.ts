import { describe, expect, it } from "vitest";
import {
  selectRequestedFacebookPhotos,
  type FacebookChatPhoto,
} from "../src/facebook-photo-selection";

const photos: FacebookChatPhoto[] = Array.from({ length: 8 }, (_, index) => ({
  url: `https://example.com/photo-${index + 1}.jpg`,
  caption: `Foto ${index + 1}`,
  link: `https://facebook.com/photo-${index + 1}`,
}));

describe("selectRequestedFacebookPhotos", () => {
  it("does not attach photos without an explicit display request", () => {
    expect(selectRequestedFacebookPhotos("O que aparece nas minhas fotos?", photos)).toBeNull();
  });

  it("selects the most recent photo for a singular display request", () => {
    const result = selectRequestedFacebookPhotos("Mostra uma foto do meu Facebook", photos);
    expect(result?.photos).toEqual([photos[0]]);
    expect(result?.responseText).toContain("foto mais recente");
  });

  it("selects the requested photo number", () => {
    const result = selectRequestedFacebookPhotos("Pode mostrar a foto número 3?", photos);
    expect(result?.photos).toEqual([photos[2]]);
    expect(result?.responseText).toContain("foto 3");
  });

  it("selects at most six photos for plural requests", () => {
    const result = selectRequestedFacebookPhotos("Mostra todas as fotos aqui", photos);
    expect(result?.photos).toEqual(photos.slice(0, 6));
    expect(result?.photos).toHaveLength(6);
  });

  it("does not silently substitute the first photo for an invalid number", () => {
    const result = selectRequestedFacebookPhotos("Mostra a foto 99", photos);
    expect(result?.photos).toEqual([]);
    expect(result?.responseText).toContain("Não encontrei a foto 99");
  });

  it("does not select photo one for zero", () => {
    const result = selectRequestedFacebookPhotos("Exibe a foto 0", photos);
    expect(result?.photos).toEqual([]);
    expect(result?.responseText).toContain("Não encontrei a foto 0");
  });

  it("returns null when there are no photos to select", () => {
    expect(selectRequestedFacebookPhotos("Mostra as fotos", [])).toBeNull();
  });
});
