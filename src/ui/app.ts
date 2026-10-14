import { buildCalls, callLine, type Call } from '../game/calls';
import { DEPART_MINUTE } from '../game/clock';
import { buildDay, type DaySummary } from '../game/day';
import { Desk } from '../game/desk';
import { generateDay } from '../game/generate';
import { growthOptions, newClientFor, type Growth, type GrowthOption, type NewClient } from '../game/growth';
import { loadMorning } from '../game/morning';
import { mulberry32 } from '../game/random';
import { buildResult, type MorningResult } from '../game/results';
import { nextDay, outcomeOf, runFromMorning, type RunState } from '../game/run';
import { buildRoad, ROAD_STEP_MINUTES, ROAD_TICK_MS, type Road } from '../game/road';
import { callNotes, stockAfterDeliveries, Supply } from '../game/supply';
import type { Morning } from '../game/types';
import type { CueArg, Moment } from './cues';
import { plural } from './format';

export type Screen = 'messages' | 'desk' | 'sheets' | 'road' | 'result' | 'supply' | 'day';
export type Pane = 'orders' | 'lines' | 'trucks';
export type Tone = 'info' | 'warn';

const PANES: readonly Pane[] = ['orders', 'lines', 'trucks'];
const MAX_DIGITS = 3;
/** How long ENTER and SPACE are ignored after a call starts ringing, in ms, so a skip does not answer it too. */
export const RING_GUARD_MS = 600;

/** What the app needs from the browser, so the game can run without one. */
export interface Effects {
  /** The sound for one moment of play; at most one per key press. */
  cue(moment: Moment, arg?: CueArg): void;
  /** Starts the dot-matrix printer for this many lines; returns how long it will run, in ms. */
  print(lines: number): number;
  /** Runs `fn` after `ms`. */
  later(fn: () => void, ms: number): void;
  /** Turns the sounds on or off; returns whether they are on now. */
  toggleSound(): boolean;
  /** A real-time clock, in ms. */
  now(): number;
  /** A random number from 0 up to but not including 1: the new days, and the other things that differ from game to game. */
  random(): number;
}

export interface KeyPress {
  key: string;
  shift?: boolean;
  /** True when the key is held down and this press is the keyboard repeating it. */
  repeat?: boolean;
}

/**
 * All of the game's state and what each key does. The screens only read it.
 * Every screen is keyboard-only: `press` is the one way in.
 */
export class App {
  screen: Screen = 'messages';
  morning: Morning;
  desk: Desk;
  /** What carries over between days, as the current day began. The next morning is worked out from it. */
  run: RunState;
  /** Seeds the current day when it is made up, so playing it again gives the same day. */
  private daySeed = 0;
  blue = false;
  soundOn = true;
  status = '';
  tone: Tone = 'info';

  msgSel = 0;

  pane: Pane = 'lines';
  orderSel = 0;
  lineSel = 0;
  truckSel = 0;
  typed = '';
  private confirmEnd = false;
  /** The sound this key press makes: the last one asked for wins. Null is silence. */
  private heard: { moment: Moment; arg?: CueArg } | null = null;

  sheetSel = 0;
  sheetOpen = new Set<number>();
  printing: { done: number; total: number } | null = null;
  private printJob = 0;
  printed = false;

  road: Road | null = null;
  roadClock = 0;
  private roadJob = 0;
  calls: Call[] = [];
  /** The option picked for each answered call, by call id. */
  answers = new Map<number, number>();
  /** The highlighted answer of the call that is ringing. */
  callSel = 0;
  private ringId: number | null = null;
  private ringAt = 0;

  result: MorningResult | null = null;
  resultSel = 0;

  supply: Supply | null = null;
  supplySel = 0;
  supplyTyped = '';

  day: DaySummary | null = null;
  daySel = 0;
  /** True while the growth choice is on show instead of the look back at the day. */
  growthOpen = false;
  /** The highlighted choice; once one is confirmed, that one. */
  growthSel = 0;
  /** What was chosen to grow, or null until it is confirmed. The next morning puts it to work. */
  growth: Growth | null = null;
  /** The restaurant that asks to join, picked at random when the order is placed so it stays the same while the day is on show. */
  private newClient: NewClient | null = null;

  constructor(
    private readonly effects: Effects,
    private readonly changed: () => void = () => {},
    morningId: 'small' | 'big' = 'small',
  ) {
    this.morning = loadMorning(morningId);
    this.run = runFromMorning(this.morning);
    this.desk = new Desk(this.morning);
  }

  /** Handles one key. Returns false for a key the game does not use. */
  press({ key, shift = false, repeat = false }: KeyPress): boolean {
    const wasConfirming = this.confirmEnd;
    this.confirmEnd = false;
    this.status = '';
    this.tone = 'info';
    this.heard = null;

    const handled = this.route(key, shift, repeat, wasConfirming);
    if (handled) {
      // One sound per key press: a warning replaces the ordinary sound, a key that only shows a message warns,
      // and a key that changed nothing is silent.
      const heard = this.heardNow();
      if (heard) this.effects.cue(heard.moment, heard.arg);
    }
    this.changed();
    return handled;
  }

  private heardNow(): { moment: Moment; arg?: CueArg } | null {
    return this.tone === 'warn' ? { moment: 'warn' } : this.heard;
  }

  private sound(moment: Moment, arg?: CueArg): void {
    this.heard = { moment, arg };
  }

  private route(key: string, shift: boolean, repeat: boolean, wasConfirming: boolean): boolean {
    if (key === 'F2') {
      this.blue = !this.blue;
      this.sound('confirm');
      return true;
    }
    if (key === 'F4') {
      this.soundOn = this.effects.toggleSound();
      this.say(this.soundOn ? 'Sound on.' : 'Sound off.');
      this.sound('confirm');
      return true;
    }
    switch (this.screen) {
      case 'messages':
        return this.messagesKey(key);
      case 'desk':
        return this.deskKey(key, shift, wasConfirming);
      case 'sheets':
        return this.sheetsKey(key);
      case 'road':
        return this.roadKey(key, repeat);
      case 'result':
        return this.resultKey(key);
      case 'supply':
        return this.supplyKey(key);
      case 'day':
        return this.dayKey(key);
    }
  }

  private say(text: string, tone: Tone = 'info'): void {
    this.status = text;
    this.tone = tone;
  }

  // ------------------------------------------------------------ messages
  private messagesKey(key: string): boolean {
    const last = this.morning.messages.length - 1;
    const before = this.msgSel;
    switch (key) {
      case 'ArrowUp':
        this.msgSel = Math.max(0, this.msgSel - 1);
        break;
      case 'ArrowDown':
        this.msgSel = Math.min(last, this.msgSel + 1);
        break;
      case 'PageUp':
        this.msgSel = Math.max(0, this.msgSel - 10);
        break;
      case 'PageDown':
        this.msgSel = Math.min(last, this.msgSel + 10);
        break;
      case ' ':
        this.screen = 'desk';
        this.sound('confirm');
        return true;
      case 'b':
      case 'B':
        this.loadMorning('big');
        this.sound('confirm');
        return true;
      case 's':
      case 'S':
        this.loadMorning('small');
        this.sound('confirm');
        return true;
      default:
        return false;
    }
    if (this.msgSel !== before) this.sound('move');
    return true;
  }

  /** Starts a new run with the fixed small or big morning, back at its overnight messages. */
  loadMorning(id: 'small' | 'big'): void {
    const morning = loadMorning(id);
    this.run = runFromMorning(morning);
    this.startDay(morning);
  }

  /** Plays the current day again from its overnight messages: the same orders, the same stock. */
  restartDay(): void {
    this.startDay(this.run.day === 1 ? loadMorning(this.run.kind) : generateDay(this.run, mulberry32(this.daySeed)));
  }

  /** The next morning: the stock left plus the supplier's delivery, the growth at work, and a made-up day of orders. */
  private nextMorning(day: DaySummary, supply: Supply): void {
    const left = stockAfterDeliveries(this.desk);
    this.run = nextDay(this.run, outcomeOf(left, supply, day, this.calls, this.answers, this.growth));
    this.daySeed = Math.floor(this.effects.random() * 4294967296);
    this.startDay(generateDay(this.run, mulberry32(this.daySeed)));
  }

  /** Puts a day's morning on the desk and clears everything the last day left on the screens. */
  private startDay(morning: Morning): void {
    this.morning = morning;
    this.desk = new Desk(this.morning);
    this.screen = 'messages';
    this.msgSel = 0;
    this.pane = 'lines';
    this.orderSel = 0;
    this.lineSel = 0;
    this.truckSel = 0;
    this.typed = '';
    this.sheetSel = 0;
    this.sheetOpen = new Set();
    this.printing = null;
    this.printed = false;
    this.road = null;
    this.calls = [];
    this.answers = new Map();
    this.callSel = 0;
    this.roadJob++;
    this.result = null;
    this.resultSel = 0;
    this.supply = null;
    this.supplySel = 0;
    this.supplyTyped = '';
    this.day = null;
    this.daySel = 0;
    this.growthOpen = false;
    this.growthSel = 0;
    this.growth = null;
    this.newClient = null;
  }

  // ------------------------------------------------------------ order desk
  private deskKey(key: string, shift: boolean, wasConfirming: boolean): boolean {
    if (!/^\d$/.test(key) && key !== 'Backspace') this.typed = '';

    switch (key) {
      case 'Tab':
        this.nextPane(shift ? -1 : 1);
        this.sound('tab');
        return true;
      case 'F10':
        this.endMorning(wasConfirming);
        return true;
      case 'ArrowUp':
        this.moveWithin(-1);
        return true;
      case 'ArrowDown':
        this.moveWithin(1);
        return true;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (this.pane === 'lines') {
          const dir = key === 'ArrowRight' ? 1 : -1;
          const before = this.desk.given(this.orderSel, this.lineSel);
          this.desk.nudgeGive(this.orderSel, this.lineSel, dir);
          this.noteTruckFull();
          if (this.desk.given(this.orderSel, this.lineSel) !== before) this.sound('nudge', { dir });
        }
        return true;
      case 'Enter':
        this.enter();
        return true;
      case 'Backspace':
        if (this.pane === 'lines') this.typeDigit(null);
        return true;
    }
    if (/^\d$/.test(key)) {
      if (this.pane === 'lines') this.typeDigit(key);
      else {
        this.say('Amounts are typed in the LINES pane: TAB to it first.');
        this.sound('warn');
      }
      return true;
    }
    return false;
  }

  private nextPane(step: number): void {
    const at = PANES.indexOf(this.pane);
    this.pane = PANES[(at + step + PANES.length) % PANES.length] as Pane;
    if (this.pane === 'trucks') this.truckSel = this.truckIndexOf(this.desk.truckFor(this.orderSel)) ?? this.truckSel;
  }

  private truckIndexOf(truckId: number | null): number | null {
    if (truckId == null) return null;
    const i = this.morning.trucks.findIndex((t) => t.id === truckId);
    return i === -1 ? null : i;
  }

  private moveWithin(step: number): void {
    const before = [this.orderSel, this.lineSel, this.truckSel];
    this.stepWithin(step);
    if (before.some((n, i) => n !== [this.orderSel, this.lineSel, this.truckSel][i])) this.sound('move');
  }

  private stepWithin(step: number): void {
    if (this.pane === 'orders') {
      this.orderSel = Math.max(0, Math.min(this.desk.orderCount - 1, this.orderSel + step));
      this.lineSel = this.desk.firstUndecidedLine(this.orderSel);
    } else if (this.pane === 'lines') {
      const n = this.desk.order(this.orderSel).lines.length;
      this.lineSel = Math.max(0, Math.min(n - 1, this.lineSel + step));
    } else {
      this.truckSel = Math.max(0, Math.min(this.morning.trucks.length - 1, this.truckSel + step));
    }
  }

  /** Typing a number sets the line as you type; null takes the last digit off. */
  private typeDigit(digit: string | null): void {
    const o = this.orderSel;
    const l = this.lineSel;
    const before = [this.typed, this.desk.given(o, l)];
    if (digit === null) this.typed = this.typed.slice(0, -1);
    else if (this.typed.length < MAX_DIGITS) this.typed += digit;
    const wanted = this.typed === '' ? 0 : Number(this.typed);
    const used = this.desk.setGive(o, l, wanted);
    if (this.typed !== '') this.typed = String(used);
    this.noteTruckFull(wanted > used);
    if (this.typed !== before[0] || this.desk.given(o, l) !== before[1]) this.sound('digit');
  }

  /** Says why a line cannot take any more, when it is the truck and not the stock. */
  private noteTruckFull(force = false): void {
    const d = this.desk;
    const o = this.orderSel;
    const l = this.lineSel;
    const truck = d.truckFor(o);
    const line = d.order(o).lines[l];
    if (truck == null || !line) return;
    const given = d.given(o, l) ?? 0;
    if ((force || given === d.maxGive(o, l)) && given < Math.min(line.asked, d.onHand(o, l))) {
      this.say(`Truck ${truck} has no more room for that.`, 'warn');
    }
  }

  private enter(): void {
    if (this.pane === 'orders') {
      this.pane = 'lines';
      this.lineSel = this.desk.firstUndecidedLine(this.orderSel);
      this.sound('confirm');
    } else if (this.pane === 'trucks') {
      const truck = this.morning.trucks[this.truckSel];
      if (truck) this.pickTruck(truck.id);
    } else {
      this.commitLine();
    }
  }

  /** Accepts the line, moves to the next, and at the last line either asks for a truck or finishes the order. */
  private commitLine(): void {
    const d = this.desk;
    const o = this.orderSel;
    const l = this.lineSel;
    d.acceptLine(o, l);
    this.typed = '';
    this.sound('confirm');
    if (l < d.order(o).lines.length - 1) {
      this.lineSel = l + 1;
      return;
    }
    if (!d.allLinesDecided(o)) {
      this.lineSel = d.firstUndecidedLine(o);
      this.say('A line above is still to do.');
    } else if (d.truckFor(o) == null) {
      this.pane = 'trucks';
      this.truckSel = Math.min(this.truckSel, this.morning.trucks.length - 1);
      this.say('Choose a truck: ↑↓ then ENTER.');
    } else {
      d.finishOrder(o);
      this.sound('finish');
      this.advance();
    }
  }

  private pickTruck(truckId: number): void {
    const d = this.desk;
    const o = this.orderSel;
    const result = d.assignTruck(o, truckId);
    if (!result.ok) {
      this.say(
        result.reason === 'full' ? `Truck ${truckId} is too full for this order. Try another.` : `There is no truck ${truckId} this morning.`,
        'warn',
      );
      return;
    }
    this.truckSel = this.truckIndexOf(truckId) ?? this.truckSel;
    if (d.allLinesDecided(o)) {
      d.finishOrder(o);
      this.sound('finish');
      this.advance();
    } else {
      this.sound('truck');
      this.pane = 'lines';
      this.lineSel = d.firstUndecidedLine(o);
      this.say(`${d.order(o).client} goes on truck ${truckId}. Some lines are still to do.`);
    }
  }

  /** Moves on to the next order that is not finished. */
  private advance(): void {
    const next = this.desk.nextUnfinished(this.orderSel);
    this.typed = '';
    if (next === -1) {
      this.pane = 'lines';
      this.say('Every order is handed out. F10 for the truck sheets.');
      return;
    }
    this.orderSel = next;
    this.lineSel = this.desk.firstUndecidedLine(next);
    this.pane = 'lines';
  }

  private endMorning(confirmed: boolean): void {
    const left = this.desk.unfinishedCount();
    if (left > 0 && !confirmed) {
      this.confirmEnd = true;
      this.say(`${plural(left, 'order')} not handed out. On a truck: go with the lines decided so far. No truck: not delivered. F10 again.`, 'warn');
      return;
    }
    this.screen = 'sheets';
    this.sound('confirm');
    this.sheetSel = 0;
    this.sheetOpen = new Set();
    this.printed = false;
    this.printing = null;
    this.typed = '';
  }

  // ------------------------------------------------------------ truck sheets
  private sheetsKey(key: string): boolean {
    const last = this.morning.trucks.length - 1;
    const before = this.sheetSel;
    const openBefore = this.sheetOpen.size;
    switch (key) {
      case 'ArrowUp':
        this.sheetSel = Math.max(0, this.sheetSel - 1);
        if (this.sheetSel !== before) this.sound('move');
        return true;
      case 'ArrowDown':
        this.sheetSel = Math.min(last, this.sheetSel + 1);
        if (this.sheetSel !== before) this.sound('move');
        return true;
      case 'Enter':
        if (this.sheetOpen.has(this.sheetSel)) this.sheetOpen.delete(this.sheetSel);
        else this.sheetOpen.add(this.sheetSel);
        this.sound(this.sheetOpen.size > openBefore ? 'sheetOpen' : 'sheetClose');
        return true;
      case '+':
      case '=':
        this.sheetOpen = new Set(this.morning.trucks.map((_, i) => i));
        if (this.sheetOpen.size !== openBefore) this.sound('sheetOpen');
        return true;
      case '-':
      case '_':
        this.sheetOpen = new Set();
        if (openBefore > 0) this.sound('sheetClose');
        return true;
      case 'p':
      case 'P':
        // The printer is the sound of this key.
        this.startPrint();
        return true;
      case 'Escape':
        this.screen = 'desk';
        this.sound('sheetClose');
        return true;
      case 'F9':
        this.sendTrucks();
        return true;
    }
    return false;
  }

  /** Prints one line for the heading, one per truck and one for the staff. */
  private startPrint(): void {
    if (this.printing) {
      this.say('The printer is still going.');
      this.sound('warn');
      return;
    }
    const total = this.morning.trucks.length + 2;
    const ms = this.effects.print(total);
    const job = ++this.printJob;
    this.printing = { done: 0, total };
    for (let i = 1; i <= total; i++) {
      this.effects.later(() => {
        if (job !== this.printJob || !this.printing) return;
        this.printing = { done: i, total };
        if (i === total) {
          this.printing = null;
          this.printed = true;
          this.say('Truck sheets printed.');
        }
        this.changed();
      }, (ms * i) / total);
    }
  }

  private sendTrucks(): void {
    if (this.printing) {
      this.say('Wait for the printer to finish first.', 'warn');
      return;
    }
    if (this.morning.trucks.every((t) => this.desk.stopsOf(t.id).length === 0)) {
      this.say('Nothing is loaded yet. ESC goes back to the desk.', 'warn');
      return;
    }
    const departAt = Math.max(DEPART_MINUTE, this.desk.clock);
    this.result = buildResult(this.desk, departAt);
    this.resultSel = 0;
    this.road = buildRoad(this.desk, this.result);
    this.calls = buildCalls(this.desk, this.result, this.road);
    this.answers = new Map();
    this.callSel = 0;
    this.roadClock = this.road.departAt;
    this.ringId = null;
    this.noteRing();
    this.screen = 'road';
    this.sound('confirm');
    this.scheduleTick(++this.roadJob);
  }

  // ------------------------------------------------------------ on the road
  /** The call that is ringing: the first one whose time has come and that is not answered yet. */
  get roadCall(): Call | null {
    return this.calls.find((c) => c.at <= this.roadClock && !this.answers.has(c.id)) ?? null;
  }

  /** True once every truck is back, every call is answered and the whole log is shown. */
  get roadOver(): boolean {
    return !!this.road && this.roadClock >= this.road.end && !this.roadCall;
  }

  /** The answered calls as result-screen lines, in the order they rang. */
  get callLines(): string[] {
    return this.calls.filter((c) => this.answers.has(c.id)).map((c) => callLine(c, this.answers.get(c.id) as number));
  }

  /** The first call still to come after the clock, if any. */
  private nextCall(): Call | undefined {
    return this.calls.find((c) => c.at > this.roadClock && !this.answers.has(c.id));
  }

  /** Notes the real time a call starts ringing, once per call. */
  private noteRing(): void {
    const call = this.roadCall;
    if (!call || call.id === this.ringId) return;
    this.ringId = call.id;
    this.ringAt = this.effects.now();
  }

  private scheduleTick(job: number): void {
    this.effects.later(() => {
      if (job !== this.roadJob || this.screen !== 'road' || !this.road || this.roadOver || this.roadCall) return;
      this.roadClock = Math.min(this.road.end, this.nextCall()?.at ?? this.road.end, this.roadClock + ROAD_STEP_MINUTES);
      this.noteRing();
      // The ticks are not key presses, so they make their own sound: a soft click, the ring of a call, the finishing knock.
      this.effects.cue(this.roadCall ? 'ring' : this.roadOver ? 'finish' : 'move');
      // The clock waits while a phone rings; answering it starts the ticks again.
      if (!this.roadOver && !this.roadCall) this.scheduleTick(job);
      this.changed();
    }, ROAD_TICK_MS);
  }

  private roadKey(key: string, repeat: boolean): boolean {
    const call = this.roadCall;
    const go = key === ' ' || key === 'Enter';
    // A held key neither answers nor skips, and a call that has just started ringing is not answered by a skip.
    if (go && (repeat || (call && this.effects.now() - this.ringAt < RING_GUARD_MS))) return true;
    if (call) {
      const last = call.options.length - 1;
      const before = this.callSel;
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        this.callSel = Math.max(0, Math.min(last, this.callSel + (key === 'ArrowUp' ? -1 : 1)));
        if (this.callSel !== before) this.sound('move');
        return true;
      }
      if (key === 'Enter') {
        this.answers.set(call.id, this.callSel);
        this.callSel = 0;
        this.sound('confirm');
        this.noteRing();
        if (this.road && this.roadClock < this.road.end) this.scheduleTick(++this.roadJob);
        return true;
      }
      if (key === ' ') {
        this.say('Answer the call first: ↑↓ then ENTER.');
        this.sound('warn');
        return true;
      }
      return false;
    }
    if (go) {
      if (!this.roadOver) {
        // Skipping runs on to the next call that is still to come, or to the end.
        this.roadClock = this.nextCall()?.at ?? this.road?.end ?? this.roadClock;
        this.noteRing();
        this.sound(this.roadCall ? 'ring' : 'confirm');
      } else if (key === 'Enter') {
        this.screen = 'result';
        this.sound('confirm');
      }
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ result
  private resultKey(key: string): boolean {
    const last = this.morning.orders.length - 1;
    const before = this.resultSel;
    switch (key) {
      case 'ArrowUp':
        this.resultSel = Math.max(0, this.resultSel - 1);
        break;
      case 'ArrowDown':
        this.resultSel = Math.min(last, this.resultSel + 1);
        break;
      case 'PageUp':
        this.resultSel = Math.max(0, this.resultSel - 10);
        break;
      case 'PageDown':
        this.resultSel = Math.min(last, this.resultSel + 10);
        break;
      case 'r':
      case 'R':
        this.restartDay();
        this.sound('confirm');
        return true;
      case 'Enter':
        this.openSupply();
        return true;
      case 'b':
      case 'B':
        this.loadMorning('big');
        this.sound('confirm');
        return true;
      case 's':
      case 'S':
        this.loadMorning('small');
        this.sound('confirm');
        return true;
      default:
        return false;
    }
    if (this.resultSel !== before) this.sound('move');
    return true;
  }

  // ------------------------------------------------------------ supplier order
  /** Opens the 13:00 order to the supplier; coming back to it keeps what was filled in. */
  private openSupply(): void {
    if (!this.supply) {
      this.supply = new Supply(this.morning, stockAfterDeliveries(this.desk), callNotes(this.calls, this.answers));
      this.supplySel = 0;
    }
    this.supplyTyped = '';
    this.screen = 'supply';
    this.sound('confirm');
  }

  private supplyKey(key: string): boolean {
    const supply = this.supply;
    if (!supply) return false;
    if (!/^\d$/.test(key) && key !== 'Backspace') this.supplyTyped = '';
    const r = this.supplySel;
    switch (key) {
      case 'Escape':
        this.screen = 'result';
        this.sound('confirm');
        return true;
      case 'F9':
        this.placeOrder(supply);
        return true;
    }
    switch (key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        const before = this.supplySel;
        this.supplySel = Math.max(0, Math.min(supply.count - 1, before + (key === 'ArrowUp' ? -1 : 1)));
        if (this.supplySel !== before) this.sound('move');
        return true;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir = key === 'ArrowRight' ? 1 : -1;
        const before = supply.amount(r);
        if (supply.nudge(r, dir) !== before) this.sound('nudge', { dir });
        return true;
      }
      case 'Enter':
        supply.confirm(r);
        this.sound('confirm');
        if (r < supply.count - 1) this.supplySel = r + 1;
        else this.say('That was the last row. F9 places the order.');
        return true;
      case 'Backspace':
        this.typeSupplyDigit(supply, null);
        return true;
      case 'u':
      case 'U': {
        const before = supply.amount(r);
        const now = supply.fillRow(r);
        if (now !== before) this.sound('confirm');
        else this.say(before > 0 ? 'That row already has an amount.' : 'That row is already up to the usual amount.');
        return true;
      }
      case 'a':
      case 'A':
        supply.fillAll();
        this.sound('confirm');
        return true;
    }
    if (/^\d$/.test(key)) {
      this.typeSupplyDigit(supply, key);
      return true;
    }
    return false;
  }

  /** Typing a number sets the row as you type; null takes the last digit off. */
  private typeSupplyDigit(supply: Supply, digit: string | null): void {
    const before = [this.supplyTyped, supply.amount(this.supplySel)];
    if (digit === null) this.supplyTyped = this.supplyTyped.slice(0, -1);
    else if (this.supplyTyped.length < MAX_DIGITS) this.supplyTyped += digit;
    const used = supply.set(this.supplySel, this.supplyTyped === '' ? 0 : Number(this.supplyTyped));
    if (this.supplyTyped !== '') this.supplyTyped = String(used);
    if (this.supplyTyped !== before[0] || used !== before[1]) this.sound('digit');
  }

  private placeOrder(supply: Supply): void {
    if (supply.total() === 0) {
      this.say('Nothing is on the order yet: type amounts, U fills a row, A fills them all.', 'warn');
      return;
    }
    supply.placed = true;
    this.supplyTyped = '';
    if (this.result) this.day = buildDay(this.result, this.calls, this.answers, supply);
    this.daySel = 0;
    this.growthOpen = false;
    this.growthSel = 0;
    this.growth = null;
    this.newClient = newClientFor(this.run.clients.map((c) => c.name), () => this.effects.random());
    this.screen = 'day';
    this.say(`Order placed for tomorrow: ${plural(supply.ordered().length, 'item')}, ${plural(supply.total(), 'unit')} in all.`);
    this.sound('finish');
  }

  // ------------------------------------------------------------ end of the day
  /** The three things the day can end by growing; empty before the day is built. */
  get growthOptions(): GrowthOption[] {
    return this.day && this.newClient ? growthOptions(this.day, this.newClient) : [];
  }

  /** R plays this day again, B and S start a new run from a fixed morning: all of them start over and drop the growth choice. */
  private restartKey(key: string): boolean {
    switch (key) {
      case 'r':
      case 'R':
        this.restartDay();
        break;
      case 'b':
      case 'B':
        this.loadMorning('big');
        break;
      case 's':
      case 'S':
        this.loadMorning('small');
        break;
      default:
        return false;
    }
    this.sound('confirm');
    return true;
  }

  private dayKey(key: string): boolean {
    if (this.restartKey(key)) return true;
    if (this.growthOpen) return this.growthKey(key);
    const last = (this.day?.orders.length ?? 1) - 1;
    const before = this.daySel;
    switch (key) {
      case 'ArrowUp':
        this.daySel = Math.max(0, this.daySel - 1);
        break;
      case 'ArrowDown':
        this.daySel = Math.min(last, this.daySel + 1);
        break;
      case 'PageUp':
        this.daySel = Math.max(0, this.daySel - 10);
        break;
      case 'PageDown':
        this.daySel = Math.min(last, this.daySel + 10);
        break;
      case 'Enter':
        this.growthOpen = true;
        this.sound('confirm');
        return true;
      default:
        return false;
    }
    if (this.daySel !== before) this.sound('move');
    return true;
  }

  /** The growth choice: pick with ↑↓ or 1-3, ENTER confirms, and U or BACKSPACE takes a confirmed choice back so another can be picked. It is final once the next morning starts. */
  private growthKey(key: string): boolean {
    const options = this.growthOptions;
    const before = this.growthSel;
    if (key === 'Escape') {
      this.growthOpen = false;
      this.sound('confirm');
      return true;
    }
    if (key === 'Enter') {
      const picked = options[this.growthSel];
      if (this.growth) {
        if (this.day && this.supply) {
          this.nextMorning(this.day, this.supply);
          this.sound('confirm');
        }
      } else if (picked) {
        this.growth = picked.growth;
        this.say(`Chosen: ${picked.title}. It takes effect tomorrow. ENTER starts the next morning.`);
        this.sound('finish');
      }
      return true;
    }
    if (key === 'u' || key === 'U' || key === 'Backspace') {
      if (!this.growth) return false;
      this.growth = null;
      this.say('Choice taken back. Pick one of the three.');
      this.sound('confirm');
      return true;
    }
    const number = /^[1-9]$/.test(key) && Number(key) <= options.length ? Number(key) - 1 : -1;
    if (key === 'ArrowUp' || key === 'ArrowDown' || number >= 0) {
      if (this.growth) return true;
      const to = number >= 0 ? number : this.growthSel + (key === 'ArrowUp' ? -1 : 1);
      this.growthSel = Math.max(0, Math.min(options.length - 1, to));
      if (this.growthSel !== before) this.sound('move');
      return true;
    }
    return false;
  }
}
