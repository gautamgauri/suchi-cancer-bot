import { VoiceService } from './voice.service';

/**
 * Session.city outlives the turn that set it, so voice persistence uses the same
 * bar the hospital lookup does (LOCATION_CONFIDENCE_FOR_GEOGRAPHY): a city the
 * caller named is written, a guess from ordinary words or a fuzzy spelling is
 * only logged.
 */
describe('VoiceService — location persistence threshold', () => {
  const setup = () => {
    const update = jest.fn().mockResolvedValue({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc: any = Object.create(VoiceService.prototype);
    svc.prisma = { session: { update } };
    svc.logger = { log: jest.fn(), warn: jest.fn() };
    return { svc, update };
  };

  it('persists a city the caller named', () => {
    const { svc, update } = setup();
    svc.tryDetectAndUpdateLocation('s-1', 'main Gaya se hoon');
    expect(update).toHaveBeenCalledWith({
      where: { id: 's-1' },
      data: { city: 'Gaya', region: 'Bihar' },
    });
  });

  it.each([
    ['Report aa gaya hai, ab kaun sa hospital jaayein'],
    ['what are the best hospitals'],
    ['I live in Muzafferpur'], // fuzzy spelling: logged, below threshold
  ])('does not persist %s', (transcript) => {
    const { svc, update } = setup();
    svc.tryDetectAndUpdateLocation('s-1', transcript);
    expect(update).not.toHaveBeenCalled();
  });
});
