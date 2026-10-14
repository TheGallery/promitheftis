import { setStrictWidths } from '../src/ui/grid';

// A line that is wider than its column is a bug in a screen: fail loudly in tests.
setStrictWidths(true);
