export interface FacebookChatPhoto {
  url: string;
  caption: string;
  link: string;
}

export interface FacebookPhotoSelection {
  photos: FacebookChatPhoto[];
  responseText: string;
}

/**
 * Select Facebook photos deterministically only when the user explicitly asks
 * to see them. A numbered request never silently falls back to another photo.
 */
export function selectRequestedFacebookPhotos(
  userText: string,
  photos: FacebookChatPhoto[],
): FacebookPhotoSelection | null {
  if (photos.length === 0) return null;

  const asksToDisplay =
    /\b(?:mostr(?:a|e|ar|em)|exib(?:a|e|ir|am)|ver|visualiz(?:a|e|ar)|apresent(?:a|e|ar)|mand(?:a|e|ar)|envia(?:r)?|abr(?:e|ir|a))\b[\s\S]{0,60}\b(?:foto|imagem)(?:s)?\b|\b(?:foto|imagem)(?:s)?\b[\s\S]{0,60}\b(?:no chat|aqui|na conversa)\b/i.test(userText);
  if (!asksToDisplay) return null;

  const numberedPhoto = userText.match(
    /\b(?:foto|imagem)(?:s)?\s*(?:(?:n[ºo.]?|número)\s*)?(\d{1,2})\b/i,
  );
  if (numberedPhoto) {
    const number = Number(numberedPhoto[1]);
    const photo = number >= 1 ? photos[number - 1] : undefined;
    return photo
      ? { photos: [photo], responseText: "Aqui está a foto " + number + " do seu Facebook." }
      : { photos: [], responseText: "Não encontrei a foto " + number + " entre as fotos disponíveis do seu Facebook." };
  }

  const multiple = /\b(?:fotos|imagens|todas|algumas)\b/i.test(userText);
  const selected = photos.slice(0, multiple ? 6 : 1);
  return {
    photos: selected,
    responseText: selected.length > 1
      ? "Aqui estão as fotos mais recentes do seu Facebook."
      : "Aqui está a foto mais recente do seu Facebook.",
  };
}
