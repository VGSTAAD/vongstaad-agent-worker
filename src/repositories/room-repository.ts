export class RoomRepository {
  private kv: KVNamespace;
  constructor(kv: KVNamespace) { this.kv = kv; }
  async getRoom(roomId: string) {
    const data = await this.kv.get(roomId, 'json');
    return data || { messages: [], turn: 0 };
  }
  async saveRoom(roomId: string, room: any) {
    await this.kv.put(roomId, JSON.stringify(room));
  }
}
