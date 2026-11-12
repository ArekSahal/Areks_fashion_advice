import { Share } from 'react-native';

/** Native: hand the JSON to the system share sheet (save to Files, AirDrop, mail…). */
export async function saveJsonFile(_filename: string, json: string): Promise<void> {
  await Share.share({ message: json });
}
