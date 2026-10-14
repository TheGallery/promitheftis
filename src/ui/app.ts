import { DEPART_MINUTE } from '../game/clock';
import { Desk } from '../game/desk';
import { loadMorning } from '../game/morning';
import { buildResult, type MorningResult } from '../game/results';
import type { Morning } from '../game/types';
import { plural } from './format';

export type Screen = 'messages' | 'desk' | 'sheets' | 'result';
export type Pane = 'orders' | 'lines' | 'trucks';
export type Tone = 'info' | 'warn';

const PANES: readonly Pane[] = ['orders', 'lines', 'trucks'];
const MAX_DIGITS = 3;

/** What the app needs from the browser, so the game can run without one. */
export interface Effects {
  /** A key click. */
  click(strong: boolean): void;
  /** Starts the dot-matrix printer for this many lines; returns how long it will run, in ms. */
  print(lines: number): number;
  /** Runs `fn` after `ms`. */
  later(fn: () => void, ms: number): void;
  /** Turns the sounds on or off; returns whether they are on now. */
  toggleSound(): boolean;
}

export interface KeyPress {
  key: string;
  shift?: boolean;
}

/**
 * All of the game's state and what each key does. The screens only read it.
 * Every screen is keyboard-only: `press` is the one way in.
 */
export class App {
  screen: Screen = 'messages';
  morning: Morning;
  desk: Desk;
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
  truckPending = false;
  private confirmEnd = false;

  sheetSel = 0;
  sheetOpen = new Set<number>();
  printing: { done: number; total: number } | null = null;
  private printJob = 0;
  printed = false;

  result: MorningResult | null = null;
  resultSel = 0;

  constructor(
    private readonly effects: Effects,
    private readonly changed: () => void = () => {},
    morningId: 'small' | 'big' = 'small',
  ) {
    this.morning = loadMorning(morningId);
    this.desk = new Desk(this.morning);
  }

  /** Handles one key. Returns false for a key the game does not use. */
  press({ key, shift = false }: KeyPress): boolean {
    const wasConfirming = this.confirmEnd;
    this.confirmEnd = false;
    this.status = '';
    this.tone = 'info';

    const handled = this.route(key, shift, wasConfirming);
    if (handled) this.effects.click(key === 'Enter' || key === ' ' || key.startsWith('F'));
    this.changed();
    return handled;
  }

  private route(key: string, shift: boolean, wasConfirming: boolean): boolean {
    if (key === 'F2') {
      this.blue = !this.blue;
      return true;
    }
    if (key === 'F4') {
      this.soundOn = this.effects.toggleSound();
      this.say(this.soundOn ? 'Sound on.' : 'Sound off.');
      return true;
    }
    switch (this.screen) {
      case 'messages':
        return this.messagesKey(key);
      case 'desk':
        return this.deskKey(key, shift, wasConfirming);
      case 'sheets':
        return this.sheetsKey(key);
      case 'result':
        return this.resultKey(key);
    }
  }

  private say(text: string, tone: Tone = 'info'): void {
    this.status = text;
    this.tone = tone;
  }

  // ------------------------------------------------------------ messages
  private messagesKey(key: string): boolean {
    const last = this.morning.messages.length - 1;
    switch (key) {
      case 'ArrowUp':
        this.msgSel = Math.max(0, this.msgSel - 1);
        return true;
      case 'ArrowDown':
        this.msgSel = Math.min(last, this.msgSel + 1);
        return true;
      case 'PageUp':
        this.msgSel = Math.max(0, this.msgSel - 10);
        return true;
      case 'PageDown':
        this.msgSel = Math.min(last, this.msgSel + 10);
        return true;
      case ' ':
        this.screen = 'desk';
        return true;
      case 'b':
      case 'B':
        this.loadMorning('big');
        return true;
      case 's':
      case 'S':
        this.loadMorning('small');
        return true;
    }
    return false;
  }

  /** Starts over with a morning, back at its overnight messages. */
  loadMorning(id: 'small' | 'big'): void {
    this.morning = loadMorning(id);
    this.desk = new Desk(this.morning);
    this.screen = 'messages';
    this.msgSel = 0;
    this.pane = 'lines';
    this.orderSel = 0;
    this.lineSel = 0;
    this.truckSel = 0;
    this.typed = '';
    this.truckPending = false;
    this.sheetSel = 0;
    this.sheetOpen = new Set();
    this.printing = null;
    this.printed = false;
    this.result = null;
    this.resultSel = 0;
  }

  // ------------------------------------------------------------ order desk
  private deskKey(key: string, shift: boolean, wasConfirming: boolean): boolean {
    if (this.truckPending) {
      this.truckPending = false;
      if (/^[1-9]$/.test(key)) {
        this.pickTruck(Number(key));
        return true;
      }
      if (key === 'Escape') return true;
    }
    if (!/^\d$/.test(key) && key !== 'Backspace') this.typed = '';

    switch (key) {
      case 'Tab':
        this.nextPane(shift ? -1 : 1);
        return true;
      case 'F10':
        this.endMorning(wasConfirming);
        return true;
      case 't':
      case 'T':
        this.truckPending = true;
        this.say('T: now press the truck number, 1 to 9.');
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
          this.desk.nudgeGive(this.orderSel, this.lineSel, key === 'ArrowRight' ? 1 : -1);
          this.noteTruckFull();
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
      else this.say('To put this order on a truck, press T and then 1 to 9.');
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
    if (digit === null) this.typed = this.typed.slice(0, -1);
    else if (this.typed.length < MAX_DIGITS) this.typed += digit;
    const wanted = this.typed === '' ? 0 : Number(this.typed);
    const used = this.desk.setGive(o, l, wanted);
    if (this.typed !== '') this.typed = String(used);
    this.noteTruckFull(wanted > used);
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
      this.say('Now pick a truck: T then 1 to 9, or ENTER on the one marked.');
    } else {
      d.finishOrder(o);
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
      this.advance();
    } else {
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
    this.sheetSel = 0;
    this.sheetOpen = new Set();
    this.printed = false;
    this.printing = null;
    this.typed = '';
  }

  // ------------------------------------------------------------ truck sheets
  private sheetsKey(key: string): boolean {
    const last = this.morning.trucks.length - 1;
    switch (key) {
      case 'ArrowUp':
        this.sheetSel = Math.max(0, this.sheetSel - 1);
        return true;
      case 'ArrowDown':
        this.sheetSel = Math.min(last, this.sheetSel + 1);
        return true;
      case 'Enter':
        if (this.sheetOpen.has(this.sheetSel)) this.sheetOpen.delete(this.sheetSel);
        else this.sheetOpen.add(this.sheetSel);
        return true;
      case '+':
      case '=':
        this.sheetOpen = new Set(this.morning.trucks.map((_, i) => i));
        return true;
      case '-':
      case '_':
        this.sheetOpen = new Set();
        return true;
      case 'p':
      case 'P':
        this.startPrint();
        return true;
      case 'Escape':
        this.screen = 'desk';
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
    this.screen = 'result';
  }

  // ------------------------------------------------------------ result
  private resultKey(key: string): boolean {
    const last = this.morning.orders.length - 1;
    switch (key) {
      case 'ArrowUp':
        this.resultSel = Math.max(0, this.resultSel - 1);
        return true;
      case 'ArrowDown':
        this.resultSel = Math.min(last, this.resultSel + 1);
        return true;
      case 'PageUp':
        this.resultSel = Math.max(0, this.resultSel - 10);
        return true;
      case 'PageDown':
        this.resultSel = Math.min(last, this.resultSel + 10);
        return true;
      case 'r':
      case 'R':
        this.loadMorning(this.morning.id);
        return true;
      case 'b':
      case 'B':
        this.loadMorning('big');
        return true;
      case 's':
      case 'S':
        this.loadMorning('small');
        return true;
    }
    return false;
  }
}
