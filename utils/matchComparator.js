'use strict';

const logger = require('./loggerService');

/**
 * Match Comparator Utility
 * Detects changes between current and previous match states
 * Identifies new matches, updated matches, and finished matches
 */
class MatchComparator {
  constructor() {
    this.logger = logger;
  }

  /**
   * Compare current matches with previous matches to detect changes
   * @param {Array} currentMatches Current match data
   * @param {Array} previousMatches Previous match data
   * @returns {Object} Comparison result with detected changes
   */
  compareMatches(currentMatches, previousMatches) {
    try {
      const startTime = Date.now();
      
      // Normalize inputs
      const current = Array.isArray(currentMatches) ? currentMatches : [];
      const previous = Array.isArray(previousMatches) ? previousMatches : [];
      
      this.logger.info('Starting match comparison', {
        currentCount: current.length,
        previousCount: previous.length,
        type: 'match_comparison'
      });

      const result = {
        newMatches: [],
        updatedMatches: [],
        finishedMatches: [],
        unchangedMatches: [],
        errors: [],
        summary: {
          totalCurrent: current.length,
          totalPrevious: previous.length,
          newCount: 0,
          updatedCount: 0,
          finishedCount: 0,
          unchangedCount: 0,
          hasChanges: false
        },
        timestamp: new Date().toISOString(),
        duration: 0
      };

      // Create maps for efficient lookup
      const currentMap = this.createMatchMap(current);
      const previousMap = this.createMatchMap(previous);

      // Find new matches (in current but not in previous)
      result.newMatches = this.findNewMatches(currentMap, previousMap);
      
      // Find updated matches (in both but with changes)
      result.updatedMatches = this.findUpdatedMatches(currentMap, previousMap);
      
      // Find finished matches (in previous but not in current)
      result.finishedMatches = this.findFinishedMatches(currentMap, previousMap);
      
      // Find unchanged matches (in both with no significant changes)
      result.unchangedMatches = this.findUnchangedMatches(currentMap, previousMap);

      // Update summary
      result.summary.newCount = result.newMatches.length;
      result.summary.updatedCount = result.updatedMatches.length;
      result.summary.finishedCount = result.finishedMatches.length;
      result.summary.unchangedCount = result.unchangedMatches.length;
      result.summary.hasChanges = result.newMatches.length > 0 || 
                                 result.updatedMatches.length > 0 || 
                                 result.finishedMatches.length > 0;

      result.duration = Date.now() - startTime;

      this.logger.info('Match comparison completed', {
        ...result.summary,
        duration: result.duration,
        type: 'match_comparison_result'
      });

      return result;

    } catch (error) {
      this.logger.error('Error during match comparison', {
        error: error.message,
        stack: error.stack,
        currentCount: Array.isArray(currentMatches) ? currentMatches.length : 'invalid',
        previousCount: Array.isArray(previousMatches) ? previousMatches.length : 'invalid',
        type: 'match_comparison_error'
      });

      return {
        newMatches: [],
        updatedMatches: [],
        finishedMatches: [],
        unchangedMatches: [],
        errors: [error.message],
        summary: {
          totalCurrent: Array.isArray(currentMatches) ? currentMatches.length : 0,
          totalPrevious: Array.isArray(previousMatches) ? previousMatches.length : 0,
          newCount: 0,
          updatedCount: 0,
          finishedCount: 0,
          unchangedCount: 0,
          hasChanges: false
        },
        timestamp: new Date().toISOString(),
        duration: 0
      };
    }
  }

  /**
   * Create a map of matches keyed by match ID for efficient lookup
   * @param {Array} matches Array of match objects
   * @returns {Map} Map of matches keyed by ID
   */
  createMatchMap(matches) {
    const map = new Map();
    
    matches.forEach(match => {
      try {
        const id = this.getMatchId(match);
        if (id) {
          map.set(id, this.normalizeMatchForComparison(match));
        }
      } catch (error) {
        this.logger.warn('Error processing match for comparison', {
          error: error.message,
          match: match,
          type: 'match_processing_error'
        });
      }
    });

    return map;
  }

  /**
   * Extract match ID from match object
   * @param {Object} match Match object
   * @returns {string|null} Match ID or null
   */
  getMatchId(match) {
    if (!match || typeof match !== 'object') {
      return null;
    }

    return match.id || 
           match.matchId || 
           match.match_id || 
           match.matchNumber || 
           match.match_number ||
           null;
  }

  /**
   * Normalize match object for comparison by extracting key fields
   * @param {Object} match Match object
   * @returns {Object} Normalized match object
   */
  normalizeMatchForComparison(match) {
    return {
      id: this.getMatchId(match),
      title: match.title || match.name || match.matchTitle || 'Unknown',
      status: match.status || match.matchStatus || 'unknown',
      score: match.score || match.currentScore || null,
      teams: {
        home: match.teams?.home || match.homeTeam || match.team1 || 'TBD',
        away: match.teams?.away || match.awayTeam || match.team2 || 'TBD'
      },
      venue: match.venue || match.stadium || null,
      format: match.format || match.matchFormat || 'unknown',
      series: match.series || match.tournament || null,
      startTime: match.startTime || match.matchTime || null,
      lastUpdated: match.lastUpdated || new Date().toISOString()
    };
  }

  /**
   * Find matches that are new (in current but not in previous)
   * @param {Map} currentMap Current matches map
   * @param {Map} previousMap Previous matches map
   * @returns {Array} Array of new matches
   */
  findNewMatches(currentMap, previousMap) {
    const newMatches = [];
    
    for (const [id, currentMatch] of currentMap) {
      if (!previousMap.has(id)) {
        newMatches.push({
          ...currentMatch,
          changeType: 'new',
          detectedAt: new Date().toISOString()
        });
      }
    }

    if (newMatches.length > 0) {
      this.logger.info('New matches detected', {
        count: newMatches.length,
        matches: newMatches.map(m => ({ id: m.id, title: m.title })),
        type: 'new_matches'
      });
    }

    return newMatches;
  }

  /**
   * Find matches that have been updated (in both but with changes)
   * @param {Map} currentMap Current matches map
   * @param {Map} previousMap Previous matches map
   * @returns {Array} Array of updated matches with change details
   */
  findUpdatedMatches(currentMap, previousMap) {
    const updatedMatches = [];
    
    for (const [id, currentMatch] of currentMap) {
      if (previousMap.has(id)) {
        const previousMatch = previousMap.get(id);
        const changes = this.detectMatchChanges(currentMatch, previousMatch);
        
        if (changes.hasChanges) {
          updatedMatches.push({
            ...currentMatch,
            changeType: 'update',
            changes: changes.changes,
            previousState: previousMatch,
            detectedAt: new Date().toISOString()
          });
        }
      }
    }

    if (updatedMatches.length > 0) {
      this.logger.info('Updated matches detected', {
        count: updatedMatches.length,
        matches: updatedMatches.map(m => ({ 
          id: m.id, 
          title: m.title, 
          changes: Object.keys(m.changes) 
        })),
        type: 'updated_matches'
      });
    }

    return updatedMatches;
  }

  /**
   * Find matches that have finished (in previous but not in current)
   * @param {Map} currentMap Current matches map
   * @param {Map} previousMap Previous matches map
   * @returns {Array} Array of finished matches
   */
  findFinishedMatches(currentMap, previousMap) {
    const finishedMatches = [];
    
    for (const [id, previousMatch] of previousMap) {
      if (!currentMap.has(id)) {
        finishedMatches.push({
          ...previousMatch,
          changeType: 'finished',
          detectedAt: new Date().toISOString()
        });
      }
    }

    if (finishedMatches.length > 0) {
      this.logger.info('Finished matches detected', {
        count: finishedMatches.length,
        matches: finishedMatches.map(m => ({ id: m.id, title: m.title })),
        type: 'finished_matches'
      });
    }

    return finishedMatches;
  }

  /**
   * Find matches that are unchanged (in both with no significant changes)
   * @param {Map} currentMap Current matches map
   * @param {Map} previousMap Previous matches map
   * @returns {Array} Array of unchanged matches
   */
  findUnchangedMatches(currentMap, previousMap) {
    const unchangedMatches = [];
    
    for (const [id, currentMatch] of currentMap) {
      if (previousMap.has(id)) {
        const previousMatch = previousMap.get(id);
        const changes = this.detectMatchChanges(currentMatch, previousMatch);
        
        if (!changes.hasChanges) {
          unchangedMatches.push({
            ...currentMatch,
            changeType: 'unchanged'
          });
        }
      }
    }

    return unchangedMatches;
  }

  /**
   * Detect specific changes between two match states
   * @param {Object} current Current match state
   * @param {Object} previous Previous match state
   * @returns {Object} Change detection result
   */
  detectMatchChanges(current, previous) {
    const changes = {};
    let hasChanges = false;

    // Check status changes
    if (current.status !== previous.status) {
      changes.status = {
        from: previous.status,
        to: current.status,
        significant: this.isSignificantStatusChange(previous.status, current.status)
      };
      hasChanges = true;
    }

    // Check score changes
    if (current.score !== previous.score) {
      changes.score = {
        from: previous.score,
        to: current.score,
        significant: true // Score changes are always significant
      };
      hasChanges = true;
    }

    // Check team changes (rare but possible)
    if (current.teams.home !== previous.teams.home || current.teams.away !== previous.teams.away) {
      changes.teams = {
        from: previous.teams,
        to: current.teams,
        significant: true
      };
      hasChanges = true;
    }

    // Check venue changes
    if (current.venue !== previous.venue) {
      changes.venue = {
        from: previous.venue,
        to: current.venue,
        significant: false
      };
      hasChanges = true;
    }

    // Check title changes
    if (current.title !== previous.title) {
      changes.title = {
        from: previous.title,
        to: current.title,
        significant: false
      };
      hasChanges = true;
    }

    return {
      hasChanges,
      changes,
      changeCount: Object.keys(changes).length
    };
  }

  /**
   * Determine if a status change is significant for broadcasting
   * @param {string} fromStatus Previous status
   * @param {string} toStatus Current status
   * @returns {boolean} Whether the change is significant
   */
  isSignificantStatusChange(fromStatus, toStatus) {
    const significantChanges = [
      ['Not Started', 'Live'],
      ['Live', 'Finished'],
      ['Live', 'Completed'],
      ['In Progress', 'Finished'],
      ['In Progress', 'Completed'],
      ['Scheduled', 'Live'],
      ['Scheduled', 'In Progress']
    ];

    return significantChanges.some(([from, to]) => 
      fromStatus.toLowerCase().includes(from.toLowerCase()) && 
      toStatus.toLowerCase().includes(to.toLowerCase())
    );
  }

  /**
   * Get comparison statistics
   * @param {Object} comparisonResult Result from compareMatches
   * @returns {Object} Statistics about the comparison
   */
  getComparisonStats(comparisonResult) {
    return {
      totalMatches: comparisonResult.summary.totalCurrent,
      newMatches: comparisonResult.summary.newCount,
      updatedMatches: comparisonResult.summary.updatedCount,
      finishedMatches: comparisonResult.summary.finishedCount,
      unchangedMatches: comparisonResult.summary.unchangedCount,
      hasChanges: comparisonResult.summary.hasChanges,
      changeRate: comparisonResult.summary.totalPrevious > 0 ? 
        (comparisonResult.summary.newCount + comparisonResult.summary.updatedCount + comparisonResult.summary.finishedCount) / comparisonResult.summary.totalPrevious : 0,
      duration: comparisonResult.duration,
      timestamp: comparisonResult.timestamp
    };
  }
}

module.exports = MatchComparator;


