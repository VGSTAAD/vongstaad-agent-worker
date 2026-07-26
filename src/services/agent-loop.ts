import { GeminiAdapter } from '../adapters/gemini';
import { RoomRepository } from '../repositories/room-repository';

export class AgentLoopService {
  private llm: GeminiAdapter;
  private rooms: RoomRepository;
  constructor(llm: GeminiAdapter, rooms: RoomRepository) {
    this.llm = llm; this.rooms = rooms;
  }
  async runLoop(roomId: string, task: string, agents: Array<{ name: string }>, maxTurns = 5) {
    const room = await this.rooms.getRoom(roomId);
    if (room.messages.length === 0) room.messages.push({ role: 'system', text: task });
    const startTurn = room.turn;
    for (let i = 0; i < maxTurns; i++) {
      const agent = agents[(startTurn + i) % agents.length];
      const reply = await this.llm.complete(agent.name, room.messages);
      room.messages.push({ role: agent.name, text: reply });
      room.turn = startTurn + i + 1;
      await this.rooms.saveRoom(roomId, room);
    }
    return room.messages;
  }
}
