import { splitText } from '@shared/text'

export { splitText }

export const download = async (name: string, data: Uint8Array | string): Promise<string> => window.api.saveFile(name, data)
