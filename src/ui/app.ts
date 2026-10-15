import { buildCalls, callLine, type Call } from '../game/calls';
import { DEPART_MINUTE } from '../game/clock';
import { buildDay, morningMoney, type DaySummary } from '../game/day';
import { Desk } from '../game/desk';
import { generateDay } from '../game/generate';
import { newClientFor, randomFrom, type NewClient } from '../game/clients';
import { growthOptions, type Growth, type GrowthOption } from '../game/growth';
import { formatMoney, growthPrice } from '../game/money';
import { loadMorning } from '../game/morning';
import { mulberry32 } from '../game/random';
import { buildResult, type MorningResult } from '../game/results';
import { nextDay, outcomeOf, runFromMorning, type RunState } from '../game/run';
import { decodeRun, decodeSettings, encodeRun, encodeSettings, type SavedRun } from '../game/save';
import { buildRoad, ROAD_STEP_MINUTES, ROAD_TICK_MS, type Road } from '../game/road';
import { callNotes, stockAfterDeliveries, Supply } from '../game/supply';
import type { Morning } from '../game/types';
import type { CueArg, Moment } from './cues';
import { plural } from './format';
import { helpPageFor, HELP_PAGES } from './help';
import type { Store } from './store';

export type Screen = 'start' | 'messages' | 'desk' | 'sheets' | 'road' | 'result' | 'supply' | 'day';
export type Pane = 'orders' | 'lines' | 'trucks';
export type Tone = 'info' | 'warn';

const PANES: readonly Pane[] = ['orders', 'lines', 'trucks'];
const MAX_DIGITS = 3;
/** What happens to an order that is not handed out when the trucks go. */
export const NOT_HANDED_OUT = 'On a truck: go with the lines decided so far. No truck: not delivered.';
/** Where the run and the settings are kept; the saved text carries its own version. */
export const RUN_KEY = 'promitheftis.run';
export const SETTINGS_KEY = 'promitheftis.settings';
/** The choices on the opening screen, in the order they are listed. */
export type StartChoice = 'continue' | 'small' | 'big';
export const START_CHOICES: readonly StartChoice[] = ['continue', 'small', 'big'];
/** How long ENTER and SPACE are ignored after a call starts ringing, in ms, so a skip does not answer it too. */
export const RING_GUARD_MS = 600;
/** How long the key for a new run over a saved run is held down before it starts, in ms. */
export const HOLD_MS = 1500;
/** How long SPACE (or R) is held to send the trucks, place the supplier order, start the next morning or play the day again, in ms. */
export const COMMIT_HOLD_MS = 700;
/** How long SPACE is ignored after the screen changes, in ms, so a double tap goes on one step and not two. */
export const ARRIVAL_PAUSE_MS = 400;

/** The steps that cannot be taken back and so need a key held down: what is asked, and for a new run, which morning. */
export type HoldAsk =
  | { action: 'newRun'; morning: 'small' | 'big' }
  | { action: 'send' | 'order' | 'morning' | 'again' };

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
  /** Sets the sounds on or off, as the settings of an earlier visit had them. */
  setSound(on: boolean): void;
  /** Where the run and the settings are saved between visits. */
  store: Store;
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
  /** The run kept from an earlier visit, while the opening screen offers to carry on with it; null otherwise. */
  saved: SavedRun | null = null;
  startSel = 0;
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
  /** The step waiting for its key to be held down; while it is set, the hold box is on show. */
  ask: HoldAsk | null = null;
  /** When the key for the step went down, in real time; null while it is up. */
  private holdSince: number | null = null;
  /** The key (lower case) that has to be held for the step asked for. */
  private holdKey = '';
  /** How long that key has to be held, in ms. */
  private holdMs = HOLD_MS;
  /** The key that has just carried out a held step and may still be held down, whose repeats are then ignored. */
  private spentKey: string | null = null;
  /** When the screen last changed, in real time. */
  private arrivedAt = Number.NEGATIVE_INFINITY;
  /** The sound this key press makes: the last one asked for wins. Null is silence. */
  private heard: { moment: Moment; arg?: CueArg } | null = null;

  /** True while the how-to-play screen is over whichever screen it was asked for from; nothing under it changes. */
  helpOpen = false;
  helpPage = 0;
  /** The message that was showing when how to play was opened, put back when it closes. */
  private helpBack: { status: string; tone: Tone } | null = null;

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
  /** The restaurant that asks to join, picked when the order is placed so it stays the same while the day is on show. */
  private newClient: NewClient | null = null;
  /**
   * What chance decides in the day: which restaurant asks to join (a number from 0 up to but not including 1) and the seed
   * of the next morning. They are drawn once when a day begins, so playing that day again offers and brings the same.
   */
  private luck = { client: 0, seed: 0 };

  constructor(
    private readonly effects: Effects,
    private readonly changed: () => void = () => {},
    morningId: 'small' | 'big' = 'small',
  ) {
    this.morning = loadMorning(morningId);
    this.run = runFromMorning(this.morning);
    this.desk = new Desk(this.morning);
    this.drawLuck();
    this.openSettings();
    this.openRun();
  }

  /** Puts the colours and the sound back as the last visit left them. */
  private openSettings(): void {
    const text = this.effects.store.read(SETTINGS_KEY);
    const settings = text == null ? null : decodeSettings(text);
    if (!settings) return;
    this.blue = settings.blue;
    this.soundOn = settings.soundOn;
    this.effects.setSound(settings.soundOn);
  }

  /**
   * With a run saved, the first screen offers to carry on with it. Without one the run starts as it always did,
   * and a save that cannot be used is left behind with a short note.
   */
  private openRun(): void {
    const text = this.effects.store.read(RUN_KEY);
    const saved = text == null ? null : decodeRun(text);
    if (saved && this.dayOf(saved)) {
      this.saved = saved;
      // Nothing is lost by leaving a first day, so there is nothing to ask: it simply opens.
      if (saved.run.day === 1) this.resume();
      else this.screen = 'start';
      return;
    }
    if (text != null) this.say('The saved run could not be used, so a new run has started.');
    this.saveRun();
  }

  /** The morning a saved run was at, or null if it cannot be built from what was kept. */
  private dayOf({ run, daySeed }: SavedRun): Morning | null {
    try {
      return this.morningOf(run, daySeed);
    } catch {
      return null;
    }
  }

  private morningOf(run: RunState, daySeed: number): Morning {
    return run.day === 1 ? loadMorning(run.kind) : generateDay(run, mulberry32(daySeed));
  }

  /** Keeps the run as the day begins, so that closing the page loses nothing but the day in play. */
  private saveRun(): void {
    this.effects.store.write(RUN_KEY, encodeRun(this.run, this.daySeed));
  }

  private saveSettings(): void {
    this.effects.store.write(SETTINGS_KEY, encodeSettings({ blue: this.blue, soundOn: this.soundOn }));
  }

  /** Handles one key. Returns false for a key the game does not use. */
  press({ key, shift = false, repeat = false }: KeyPress): boolean {
    const key0 = key.toLowerCase();
    if (repeat && key0 === this.spentKey) return true;
    if (!repeat) this.spentKey = null;
    const asked = this.ask;
    if (asked && !this.helpOpen && key0 === this.holdKey) {
      // The key the box asks to be held: the first press starts the fill, the keyboard repeating it changes nothing.
      if (!repeat && this.holdSince == null) {
        this.holdSince = this.effects.now();
        this.changed();
      }
      return true;
    }
    if (this.helpOpen || (key0 === 'h' && !repeat)) {
      // How to play only pauses a step waiting for its key: the box is still there, empty, when it closes.
      this.holdSince = null;
      const used = this.helpKey(key, repeat);
      this.changed();
      return used;
    }
    this.cancelHold();
    if (asked && key === 'Escape') {
      this.changed();
      return true;
    }
    // A held SPACE or ENTER never goes on by itself, and SPACE just after the screen changed is a double tap.
    if (repeat && (key === ' ' || key === 'Enter')) return true;
    if (key === ' ' && this.effects.now() - this.arrivedAt < ARRIVAL_PAUSE_MS) return true;
    this.status = '';
    this.tone = 'info';
    this.heard = null;

    const from = this.where();
    const handled = this.route(key, shift);
    this.noteArrival(from);
    if (handled) {
      // One sound per key press: a warning replaces the ordinary sound, a key that only shows a message warns,
      // and a key that changed nothing is silent.
      const heard = this.heardNow();
      if (heard) this.effects.cue(heard.moment, heard.arg);
    }
    this.changed();
    return handled;
  }

  /**
   * How to play: H opens it from any screen and H or ESC closes it, back at exactly the screen and state it was
   * opened from, with a step still waiting for its key (the hold box, empty). While it is open no key reaches the
   * game under it, the road's clock waits, and the message that was showing is kept for when it closes. The page
   * turns with the arrows and PgUp / PgDn.
   */
  private helpKey(key: string, repeat: boolean): boolean {
    const key0 = key.toLowerCase();
    if (!this.helpOpen) {
      this.helpOpen = true;
      this.helpPage = helpPageFor(this.screen);
      this.helpBack = { status: this.status, tone: this.tone };
      this.status = '';
      this.tone = 'info';
      this.roadJob++;
      this.effects.cue('confirm');
      return true;
    }
    if (key === 'F2' || key === 'F4') {
      this.status = '';
      this.tone = 'info';
      this.heard = null;
      this.route(key, false);
      return this.cueHeard();
    }
    if (key0 === 'h' || key === 'Escape') {
      if (repeat) return true;
      this.helpOpen = false;
      this.status = this.helpBack?.status ?? '';
      this.tone = this.helpBack?.tone ?? 'info';
      this.helpBack = null;
      this.effects.cue('confirm');
      this.resumeRoad();
      return true;
    }
    const step = key === 'ArrowRight' || key === 'PageDown' ? 1 : key === 'ArrowLeft' || key === 'PageUp' ? -1 : 0;
    if (step === 0) return false;
    const before = this.helpPage;
    this.helpPage = Math.max(0, Math.min(HELP_PAGES.length - 1, before + step));
    if (this.helpPage !== before) this.effects.cue('move');
    return true;
  }

  /** Plays the sound a key press asked for; true so a handler can end with it. */
  private cueHeard(): boolean {
    const heard = this.heardNow();
    if (heard) this.effects.cue(heard.moment, heard.arg);
    return true;
  }

  /** Back on the road after how to play: the clock goes on from where it stood, a tick later. */
  private resumeRoad(): void {
    if (this.screen === 'road' && this.road && !this.roadOver && !this.roadCall) this.scheduleTick(++this.roadJob);
  }

  private heardNow(): { moment: Moment; arg?: CueArg } | null {
    return this.tone === 'warn' ? { moment: 'warn' } : this.heard;
  }

  private sound(moment: Moment, arg?: CueArg): void {
    this.heard = { moment, arg };
  }

  /** Which screen is showing, for noticing a change. */
  private where(): string {
    return `${this.screen}/${this.growthOpen}`;
  }

  /** Starts the short pause for SPACE when the screen is not the one it was. */
  private noteArrival(from: string): void {
    if (this.where() !== from) this.arrivedAt = this.effects.now();
  }

  private route(key: string, shift: boolean): boolean {
    if (key === 'F2') {
      this.blue = !this.blue;
      this.saveSettings();
      this.sound('confirm');
      return true;
    }
    if (key === 'F4') {
      this.soundOn = this.effects.toggleSound();
      this.saveSettings();
      this.say(this.soundOn ? 'Sound on.' : 'Sound off.');
      this.sound('confirm');
      return true;
    }
    switch (this.screen) {
      case 'start':
        return this.startKey(key);
      case 'messages':
        return this.messagesKey(key);
      case 'desk':
        return this.deskKey(key, shift);
      case 'sheets':
        return this.sheetsKey(key);
      case 'road':
        return this.roadKey(key);
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

  // ------------------------------------------------------------ opening screen
  private startKey(key: string): boolean {
    const before = this.startSel;
    switch (key) {
      case 'ArrowUp':
      case 'ArrowDown':
        this.startSel = Math.max(0, Math.min(START_CHOICES.length - 1, before + (key === 'ArrowUp' ? -1 : 1)));
        if (this.startSel !== before) this.sound('move');
        return true;
      case '1':
      case '2':
      case '3':
        this.startSel = Number(key) - 1;
        if (this.startSel !== before) this.sound('move');
        return true;
      case 'Enter':
        return this.choose(START_CHOICES[this.startSel] as StartChoice, key);
      case ' ':
      case 'c':
      case 'C':
        return this.choose('continue', key);
      case 's':
      case 'S':
        return this.choose('small', key);
      case 'b':
      case 'B':
        return this.choose('big', key);
    }
    return false;
  }

  /** Continue is one press; a new run replaces the save, so the key that chose it has to be held down (see `tick`). SPACE always continues. */
  private choose(choice: StartChoice, key: string): boolean {
    if (choice === 'continue') {
      this.resume();
      this.sound('confirm');
    } else {
      this.askHold({ action: 'newRun', morning: choice }, key);
    }
    return true;
  }

  /** Carries on with the saved run, at the start of the day it was saved at: the same morning R plays again. */
  private resume(): void {
    const saved = this.saved;
    if (!saved) return;
    this.run = saved.run;
    this.daySeed = saved.daySeed;
    this.saved = null;
    this.startDay(this.morningOf(saved.run, saved.daySeed));
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
        return this.newRun('big');
      case 's':
      case 'S':
        return this.newRun('small');
      default:
        return false;
    }
    if (this.msgSel !== before) this.sound('move');
    return true;
  }

  /**
   * B or S during play. A new run drops the day in play and, from day 2 on, replaces the saved one, so the key has to be
   * held down until the box fills (see `tick`). Only on the overnight messages of day 1, with nothing played yet, it
   * starts at once.
   */
  private newRun(id: 'small' | 'big'): boolean {
    if (this.run.day > 1 || this.screen !== 'messages') {
      this.askHold({ action: 'newRun', morning: id }, id === 'big' ? 'b' : 's');
      return true;
    }
    this.loadMorning(id);
    this.sound('confirm');
    return true;
  }

  /** Puts a step that cannot be taken back in the hold box: the key has to be held down until the bar is full. */
  private askHold(ask: HoldAsk, key = ' '): void {
    this.ask = ask;
    this.holdKey = key.toLowerCase();
    this.holdMs = ask.action === 'newRun' ? HOLD_MS : COMMIT_HOLD_MS;
    this.holdSince = this.effects.now();
  }

  /** The name of the key to hold, as the box shows it. */
  get holdKeyName(): string {
    return this.holdKey === ' ' ? 'SPACE' : this.holdKey.toUpperCase();
  }

  /** The fixed morning a new run was asked for, or null while something else (or nothing) is asked. */
  get newRunAsk(): 'small' | 'big' | null {
    return this.ask?.action === 'newRun' ? this.ask.morning : null;
  }

  private cancelHold(): void {
    this.ask = null;
    this.holdSince = null;
  }

  /** True while the key for a step is held down and the bar is filling. */
  get holding(): boolean {
    return this.ask != null && this.holdSince != null;
  }

  /** How much of the hold bar is filled, 0 to 1. */
  get holdProgress(): number {
    return this.holdSince == null ? 0 : Math.max(0, Math.min(1, (this.effects.now() - this.holdSince) / this.holdMs));
  }

  /** Called as often as the screen is drawn while `holding`: the bar fills, and when it is full the step is taken. */
  tick(): void {
    const ask = this.ask;
    if (!ask || this.holdSince == null) return;
    if (this.holdProgress >= 1) {
      const from = this.where();
      this.cancelHold();
      this.spentKey = this.holdKey;
      this.status = '';
      this.tone = 'info';
      this.heard = null;
      this.carryOut(ask);
      this.noteArrival(from);
      const heard = this.heardNow();
      this.effects.cue(heard?.moment ?? 'confirm', heard?.arg);
    }
    this.changed();
  }

  private carryOut(ask: HoldAsk): void {
    switch (ask.action) {
      case 'newRun':
        this.loadMorning(ask.morning);
        break;
      case 'send':
        this.sendTrucks();
        break;
      case 'order':
        if (this.supply) this.placeOrder(this.supply);
        break;
      case 'morning':
        if (this.day && this.supply) this.nextMorning(this.day, this.supply);
        break;
      case 'again':
        this.restartDay();
        break;
    }
  }

  /** A key has come up: letting go of the key for a step before the bar is full empties it and nothing happens. */
  release(key: string): void {
    if (key.toLowerCase() === this.spentKey) this.spentKey = null;
    if (!this.ask || this.holdSince == null || key.toLowerCase() !== this.holdKey) return;
    this.holdSince = null;
    this.changed();
  }

  /** The page has lost the keyboard: no key is held any more. */
  releaseAll(): void {
    this.spentKey = null;
    if (this.holdSince == null) return;
    this.holdSince = null;
    this.changed();
  }

  /** Starts a new run with the fixed small or big morning, back at its overnight messages. */
  loadMorning(id: 'small' | 'big'): void {
    const morning = loadMorning(id);
    this.run = runFromMorning(morning);
    this.daySeed = 0;
    this.saved = null;
    this.startDay(morning);
    this.saveRun();
  }

  /** Plays the current day again from its overnight messages: the same orders, the same stock, the same chances. */
  restartDay(): void {
    this.startDay(this.morningOf(this.run, this.daySeed), false);
  }

  private drawLuck(): void {
    this.luck = { client: this.effects.random(), seed: Math.floor(this.effects.random() * 4294967296) };
  }

  /** The next morning: the stock left plus the supplier's delivery, the growth at work, and a made-up day of orders. */
  private nextMorning(day: DaySummary, supply: Supply): void {
    const left = stockAfterDeliveries(this.desk);
    this.run = nextDay(this.run, outcomeOf(left, supply, day, this.calls, this.answers, this.growth));
    this.daySeed = this.luck.seed;
    this.startDay(generateDay(this.run, mulberry32(this.daySeed)));
    this.saveRun();
  }

  /** Puts a day's morning on the desk and clears everything the last day left on the screens; a new day draws its chances. */
  private startDay(morning: Morning, fresh = true): void {
    if (fresh) this.drawLuck();
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
    this.cancelHold();
  }

  // ------------------------------------------------------------ order desk
  private deskKey(key: string, shift: boolean): boolean {
    if (!/^\d$/.test(key) && key !== 'Backspace') this.typed = '';

    switch (key) {
      case 'Tab':
        this.nextPane(shift ? -1 : 1);
        this.sound('tab');
        return true;
      case ' ':
        this.openSheets();
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
    // Nothing typed on a line that is not decided yet: there is nothing to take off.
    if (digit === null && this.typed === '' && this.desk.given(o, l) == null) return;
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
      this.say('Every order is handed out. SPACE for the truck sheets.');
      return;
    }
    this.orderSel = next;
    this.lineSel = this.desk.firstUndecidedLine(next);
    this.pane = 'lines';
  }

  /** The truck sheets. Nothing is committed here, so orders still to hand out are only a warning: ESC goes back to them. */
  private openSheets(): void {
    this.screen = 'sheets';
    this.sound('confirm');
    this.sheetSel = 0;
    this.sheetOpen = new Set();
    this.printed = false;
    this.printing = null;
    this.typed = '';
    const left = this.desk.unfinishedCount();
    if (left > 0) this.say(`${plural(left, 'order')} not handed out. ${NOT_HANDED_OUT}`, 'warn');
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
        // Leaving the sheets ends a print that is still going: its last line says nothing on the desk.
        this.printJob++;
        this.printing = null;
        this.screen = 'desk';
        this.sound('sheetClose');
        return true;
      case ' ':
        this.askSend();
        return true;
    }
    return false;
  }

  /** Sending the trucks cannot be taken back, so SPACE has to be held down; nothing is asked while the sheets cannot go. */
  private askSend(): void {
    if (this.printing) {
      this.say('Wait for the printer to finish first.', 'warn');
      return;
    }
    if (this.morning.trucks.every((t) => this.desk.stopsOf(t.id).length === 0)) {
      this.say('Nothing is loaded yet. ESC goes back to the desk.', 'warn');
      return;
    }
    this.askHold({ action: 'send' });
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

  /** SPACE skips ahead, and once every truck is home goes on to the result; ENTER only answers a call. */
  private roadKey(key: string): boolean {
    const call = this.roadCall;
    // A call that has just started ringing is not answered by a key that was meant for what came before it.
    if (call && (key === ' ' || key === 'Enter') && this.effects.now() - this.ringAt < RING_GUARD_MS) return true;
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
    if (key === 'Enter') {
      this.say(this.roadOver ? 'SPACE shows how it went.' : 'SPACE skips ahead.');
      return true;
    }
    if (key === ' ') {
      if (!this.roadOver) {
        // Skipping runs on to the next call that is still to come, or to the end.
        this.roadClock = this.nextCall()?.at ?? this.road?.end ?? this.roadClock;
        this.noteRing();
        this.sound(this.roadCall ? 'ring' : 'confirm');
      } else {
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
        this.askHold({ action: 'again' }, 'r');
        return true;
      case ' ':
        this.openSupply();
        return true;
      case 'b':
      case 'B':
        return this.newRun('big');
      case 's':
      case 'S':
        return this.newRun('small');
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
      case ' ':
        this.askOrder(supply);
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
        else this.say('That was the last row. Hold SPACE to place the order.');
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

  /** Placing the order cannot be taken back, so SPACE has to be held down; an empty order is not placed. */
  private askOrder(supply: Supply): void {
    if (supply.total() === 0) {
      this.say('Nothing is on the order yet: type amounts, U fills a row, A fills them all.', 'warn');
      return;
    }
    this.askHold({ action: 'order' });
  }

  private placeOrder(supply: Supply): void {
    supply.placed = true;
    this.supplyTyped = '';
    if (this.result) this.day = buildDay(this.result, this.calls, this.answers, supply, this.run.history, this.run.cash, this.run.promises);
    this.daySel = 0;
    this.growthOpen = false;
    this.growthSel = 0;
    this.growth = null;
    this.newClient = newClientFor(this.run.clients.map((c) => c.name), randomFrom(this.luck.client));
    this.screen = 'day';
    this.say(`Order placed for tomorrow: ${plural(supply.ordered().length, 'item')}, ${plural(supply.total(), 'unit')} in all.`);
    this.sound('finish');
  }

  // ------------------------------------------------------------ end of the day
  /** The three things the day can end by growing; empty before the day is built. */
  get growthOptions(): GrowthOption[] {
    return this.day && this.newClient ? growthOptions(this.day, this.newClient, this.run) : [];
  }

  /** What growth has been paid for so far: the price of the choice, or nothing until one is confirmed. */
  get growthPaid(): number {
    return this.growth ? growthPrice(this.growth, this.run.clients.length, this.run.trucks.length) : 0;
  }

  /**
   * The cash in the bank now. It is what the day began with until the trucks have gone; then the restaurants have
   * paid and the trucks are paid for, and once the order is placed the day is settled, less any growth chosen.
   */
  get cash(): number {
    if (this.day) return this.day.money.cash - this.growthPaid;
    if (this.result && (this.screen === 'result' || this.screen === 'supply')) {
      const { takenIn, trucks } = this.morningMoney();
      return this.run.cash + takenIn - trucks;
    }
    return this.run.cash;
  }

  /** What the restaurants paid for this morning's deliveries and what the trucks cost, once the trucks have gone. */
  morningMoney(): { takenIn: number; trucks: number } {
    return this.result ? morningMoney(this.result, (item) => this.desk.item(item).kept) : { takenIn: 0, trucks: 0 };
  }

  /** R plays this day again once it has been held, B and S start a new run from a fixed morning once the key has been held: all of them start over and drop the order and the growth choice. */
  private restartKey(key: string): boolean {
    switch (key) {
      case 'r':
      case 'R':
        this.askHold({ action: 'again' }, 'r');
        return true;
      case 'b':
      case 'B':
        return this.newRun('big');
      case 's':
      case 'S':
        return this.newRun('small');
    }
    return false;
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
      case ' ':
        this.growthOpen = true;
        this.sound('confirm');
        return true;
      default:
        return false;
    }
    if (this.daySel !== before) this.sound('move');
    return true;
  }

  /** The growth choice: pick with ↑↓ or 1-3, ENTER confirms, and U or BACKSPACE takes a confirmed choice back so another can be picked. SPACE, held down, starts the next morning, and the choice is final from then on. */
  private growthKey(key: string): boolean {
    const options = this.growthOptions;
    const before = this.growthSel;
    if (key === 'Escape') {
      this.growthOpen = false;
      this.sound('confirm');
      return true;
    }
    if (key === ' ') {
      if (this.growth) this.askHold({ action: 'morning' });
      else this.say('Choose one of the three first: ↑↓ then ENTER.', 'warn');
      return true;
    }
    if (key === 'Enter') {
      const picked = options[this.growthSel];
      if (this.growth) {
        this.say('Hold SPACE to start the next morning, or U to change the choice.');
      } else if (picked && !picked.affordable) {
        this.say('Not enough money yet.', 'warn');
      } else if (picked) {
        this.growth = picked.growth;
        const paid = picked.price > 0 ? ` ${formatMoney(picked.price)} paid.` : '';
        this.say(`Chosen: ${picked.title}.${paid} It takes effect tomorrow. Hold SPACE to start the next morning.`);
        this.sound('finish');
      }
      return true;
    }
    if (key === 'u' || key === 'U' || key === 'Backspace') {
      if (!this.growth) return false;
      const back = this.growthPaid > 0 ? ` ${formatMoney(this.growthPaid)} is back in the bank.` : '';
      this.growth = null;
      this.say(`Choice taken back.${back} Pick one of the three.`);
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
