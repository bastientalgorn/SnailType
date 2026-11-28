"""
A simple typing test application.
Displays a string in white, colors characters green as typed correctly,
red if incorrect, and tracks completion time.
"""

import sys
import time
import msvcrt
import json
import os
import random
import argparse
from colorama import init, Fore, Style

# Initialize colorama for Windows - enables ANSI color codes in Windows terminals
init()

# Global variable to store word data loaded from word_data.json
# Structure: {word: [success_count, failure_count]}
# This persists across program runs to track long-term typing performance
WORD_DATA = {}

# Global variable to store the last 1000 characters that were mistyped
# Stored as a string where each character is the target that should have been typed
# This helps identify which characters are most problematic
MISTYPED_CHARS = ""

# Global options for test configuration - these control test behavior
OPTIONS = {
    # Word selection criteria
    'MIN_WORD_LENGTH': 3,   # Minimum number of characters in selected words
    'MAX_WORD_LENGTH': 20,  # Maximum number of characters in selected words
    'NUM_WORDS': 3,         # Number of unique words selected for each test
    'REPETITION': 3,        # Number of times the selected words will be repeated in the test
    
    # Performance requirements
    'MIN_WPM': 60,          # Minimum WPM required to pass (0 = no minimum)
    'ALLOW_ERROR': False,   # Whether typing errors are allowed (False = must be perfect)
    
    # Test repetition and difficulty adjustment
    'MAX_TEST_REPEAT': 20,  # Maximum number of times to repeat a failed test before moving on
    'WPM_REDUCTION': 5      # Amount to reduce WPM threshold after each failed attempt (0 = no reduction)
                            # This creates progressive difficulty - if you type perfectly but too slowly,
                            # the speed requirement gradually decreases to help you progress
}


def load_words():
    """
    Load words from word_list.txt and initialize word_data.json.
    
    This function:
    1. Reads the word list file to get all available words
    2. Loads existing statistics from word_data.json (if it exists)
    3. Adds any new words from the word list with initial stats [0, 0]
    4. Saves the updated data back to word_data.json
    
    The word_data.json file structure is: {"words": {word: [successes, failures]}}
    We use lists instead of tuples for JSON compatibility.
    """
    # Read words from word_list.txt - this is our master list of available words
    words = set()
    try:
        with open('word_list.txt', 'r', encoding='utf-8') as f:
            content = f.read()
            # Split by whitespace (spaces, newlines, tabs, etc.)
            raw_words = content.split()
            # Convert to lowercase and add to set (set ensures uniqueness)
            words = {word.lower() for word in raw_words}
    except FileNotFoundError:
        # If word list doesn't exist, we can't practice any words
        print("Warning: word_list.txt not found. Creating empty word set.")
        words = set()
    
    # Load existing data from word_data.json or create empty dict
    # This preserves statistics from previous sessions
    data = {}
    mistyped_chars = ""
    if os.path.exists('word_data.json'):
        try:
            with open('word_data.json', 'r', encoding='utf-8') as f:
                loaded = json.load(f)
                # Support both old format (flat dict) and new format (with 'words' key wrapper)
                # This provides backward compatibility if the file format changes
                if 'words' in loaded:
                    data = loaded['words']
                else:
                    data = loaded
                # Load mistyped characters list if it exists
                if 'mistyped_chars' in loaded:
                    mistyped_chars_data = loaded['mistyped_chars']
                    # Support both old format (list) and new format (string)
                    if isinstance(mistyped_chars_data, list):
                        mistyped_chars = ''.join(mistyped_chars_data)
                    else:
                        mistyped_chars = mistyped_chars_data
        except (json.JSONDecodeError, FileNotFoundError):
            # Corrupted or missing JSON file - start fresh
            print("Warning: Could not read word_data.json. Starting with empty data.")
            data = {}
    
    # Add new words with initial value [0, 0]
    # This ensures any words added to word_list.txt are included with zero statistics
    # Note: Using lists instead of tuples because JSON doesn't support tuples
    # The two integers represent [successes, failures] when typing that word
    for word in words:
        if word not in data:
            data[word] = [0, 0]  # [successes, failures]
    
    # Update global MISTYPED_CHARS
    global MISTYPED_CHARS
    MISTYPED_CHARS = mistyped_chars
    
    # Save data back to word_data.json with 'words' and 'mistyped_chars' keys
    # We save immediately to ensure the file is initialized properly
    with open('word_data.json', 'w', encoding='utf-8') as f:
        json.dump({'words': data, 'mistyped_chars': mistyped_chars}, f, indent=4, ensure_ascii=False)
    
    return data


def update_word_stats(words, word_results):
    """
    Update word statistics in WORD_DATA and save to word_data.json.
    
    This function is called after each test to record performance on each word.
    Words can appear multiple times in a test (due to REPETITION setting),
    so we aggregate all occurrences before updating the global statistics.
    
    Args:
        words: List of words that were typed in the test
        word_results: List of booleans (True = typed perfectly, False = had errors)
    """
    global WORD_DATA
    
    # First, aggregate statistics for this test
    # If the same word appeared multiple times, we count each occurrence
    word_stats = {}  # {word: [successes, failures]}
    
    for word, success in zip(words, word_results):
        word_lower = word.lower()
        if word_lower not in word_stats:
            word_stats[word_lower] = [0, 0]
        
        # Count this occurrence as either a success or failure
        if success:
            word_stats[word_lower][0] += 1  # Increment successes
        else:
            word_stats[word_lower][1] += 1  # Increment failures
    
    # Now merge the test statistics into the global WORD_DATA
    # This accumulates statistics across all tests and sessions
    for word, stats in word_stats.items():
        if word in WORD_DATA:
            WORD_DATA[word][0] += stats[0]  # Add successes to running total
            WORD_DATA[word][1] += stats[1]  # Add failures to running total
        else:
            # Word wasn't in data (maybe manually added to test), initialize it
            WORD_DATA[word] = stats
    
    # Persist the updated statistics to disk immediately
    # This ensures data isn't lost if the program crashes
    with open('word_data.json', 'w', encoding='utf-8') as f:
        json.dump({'words': WORD_DATA, 'mistyped_chars': MISTYPED_CHARS}, f, indent=4, ensure_ascii=False)


def extract_ngrams(n, data):
    """
    Extract all N-grams from words in the data dictionary and add them to data.
    
    N-grams are substrings of length N. For example, "cat" has 2-grams: "ca", "at".
    This function can be used to practice specific character combinations that are difficult.
    
    Note: This function is currently defined but not used in the main flow.
    It could be integrated to allow practicing specific character patterns.
    
    Args:
        n: The length of n-grams to extract (e.g., 2 for bigrams, 3 for trigrams)
        data: Dictionary with word data {word: [successes, failures]}
        
    Returns:
        Updated data dictionary with n-grams added as new entries
    """
    # Get all words currently in data - we'll extract n-grams from these
    words = list(data.keys())
    
    # Extract n-grams from each word
    for word in words:
        # Only extract n-grams from words that are long enough
        if len(word) >= n:
            # Extract all possible n-grams from this word using a sliding window
            # For "hello" with n=3: "hel", "ell", "llo"
            for i in range(len(word) - n + 1):
                ngram = word[i:i+n]
                
                # Add n-gram to data if not already present
                # Initialize with [0, 0] so it can be practiced and tracked
                if ngram not in data:
                    data[ngram] = [0, 0]  # [successes, failures]
    
    return data


def select_words_to_practice(n, min_length=None, max_length=None):
    """
    Select N words that need the most practice based on success rates.
    
    This uses a Beta-Binomial model to estimate success probability for each word.
    Words with lower estimated success rates are prioritized for practice.
    
    The Beta prior (alpha=1, beta=9) starts with a pessimistic assumption:
    new words are assumed to have ~10% success rate until proven otherwise.
    This ensures new words get practiced early.
    
    Args:
        n: Number of words to select
        min_length: Minimum word length (inclusive), None for no minimum
        max_length: Maximum word length (inclusive), None for no maximum
        
    Returns:
        List of N words to practice (shuffled, but prioritizing words with lower success rates)
    """
    global WORD_DATA
    
    # Alternative approach: calculate adaptive prior from overall performance
    # This is commented out but could be used to make the prior match your overall skill level
    # total_success = sum(stats[0] for stats in WORD_DATA.values())
    # total_failure = sum(stats[1] for stats in WORD_DATA.values())
    # alpha = total_success + 1
    # beta  = total_failure + 1
    # magnitude = alpha + beta
    # alpha *= 4/magnitude
    # beta *= 4/magnitude

    # Beta prior parameters for the Beta-Binomial model
    # alpha=1, beta=9 means we assume ~10% success rate for unknown words
    # This pessimistic prior ensures new/difficult words get selected for practice
    alpha, beta = 1, 9
    
    # Calculate estimated success probability P[word] for each word using Beta-Binomial model
    # Formula: P = (alpha + successes) / (alpha + beta + successes + failures)
    word_success_proba = []
    for word, stats in WORD_DATA.items():
        # Filter by word length constraints from OPTIONS
        if min_length is not None and len(word) < min_length:
            continue
        if max_length is not None and len(word) > max_length:
            continue
        
        success = stats[0]
        failure = stats[1]
        
        # If there is no data (no successes or failures), set probability to -1
        # This ensures completely new words are prioritized (sorted first)
        if success == 0 and failure == 0:
            p = -1
        else:
            # Beta-Binomial posterior mean formula
            # The prior (alpha, beta) is updated with observed data (success, failure)
            numerator = alpha + success
            denominator = alpha + beta + success + failure
            p = numerator / denominator
        
        word_success_proba.append((word, p))
    
    # Sort by P (ascending order - lowest P first, needs most practice)
    # Words with lower success probability need more practice
    word_success_proba.sort(key=lambda x: x[1])
    
    # Return top N words (just the words, not the probabilities)
    # If fewer words available than requested, return what we have
    top_n_words = [word for word, p in word_success_proba[:min(n, len(word_success_proba))]]

    # Shuffle the selected words so the order varies between tests
    # This prevents always practicing words in the same sequence
    random.shuffle(top_n_words)

    # Uncomment this to debug word selection:
    # print(word_success_proba[:30])

    return top_n_words


def clear_line():
    """Clear the current line in the terminal."""
    # Move cursor to start (\r), write spaces to clear, move cursor to start again
    sys.stdout.write('\r' + ' ' * 80 + '\r')
    sys.stdout.flush()


def display_progress(target_text, typed_text, has_error=False):
    """
    Display the target text with appropriate coloring to show typing progress.
    
    Color scheme:
    - Green: correctly typed characters
    - Red: incorrectly typed characters (or red square █ for incorrect spaces)
    - White: characters not yet typed
    
    Args:
        target_text: The string to type
        typed_text: What the user has typed so far
        has_error: Whether the last character was incorrect (currently unused but kept for compatibility)
    """
    output = "\r"  # Move cursor to beginning of line (carriage return)
    
    # Go through each character in the target text
    for i, char in enumerate(target_text):
        if i < len(typed_text):
            # This character has been typed - check if it's correct
            if typed_text[i] == char:
                # Correct character - show in green for positive feedback
                output += Fore.GREEN + char + Style.RESET_ALL
            else:
                # Incorrect character - show in red for negative feedback
                # Special case: if the target is a space but typed incorrectly, show red square
                # This makes the error visible (spaces are otherwise invisible)
                if char == ' ':
                    output += Fore.RED + '█' + Style.RESET_ALL
                else:
                    output += Fore.RED + char + Style.RESET_ALL
        else:
            # Not yet typed - show in white (neutral)
            output += Fore.WHITE + char + Style.RESET_ALL
    
    # Write the colored string to stdout and flush to show immediately
    sys.stdout.write(output)
    sys.stdout.flush()


def run_single_typing_test(test_string, current_wpm_threshold):
    """
    Run a single typing test iteration.
    
    This function handles:
    1. Displaying the test string with real-time color feedback
    2. Capturing keystrokes and tracking correctness
    3. Timing the test to calculate WPM
    4. Tracking per-word accuracy for statistics
    5. Determining pass/fail based on WPM and error criteria
    
    Args:
        test_string: The string to type
        current_wpm_threshold: The WPM threshold for this attempt (may be reduced from OPTIONS['MIN_WPM'])
        
    Returns:
        tuple: (test_passed, wpm, error_passed, wpm_passed, words, word_results)
            - test_passed: bool, whether the test met all requirements
            - wpm: float, words per minute achieved
            - error_passed: bool, whether error requirement was met
            - wpm_passed: bool, whether speed requirement was met
            - words: list of words in the test
            - word_results: list of bools indicating if each word was typed perfectly
    """
    typed = ""  # Accumulates the characters the user has typed
    start_time = None  # Will be set on first keystroke (not when test starts)
    
    # Track which character positions have ever had errors
    # This persists even after backspace, so we know if a word was ever typed incorrectly
    char_ever_wrong = set()  # Set of character indices that were ever typed wrong
    
    # Show the initial display (all characters in white)
    display_progress(test_string, typed)
    
    # Clear keyboard buffer to prevent keys from previous test being used
    # This avoids accidental keypresses carrying over between tests
    while msvcrt.kbhit():
        msvcrt.getch()
    
    # Main input loop - process keystrokes until test is complete
    while True:
        # Check if test is complete: all characters typed AND everything correct
        # We require both conditions because we allow backspace (so length alone isn't enough)
        if len(typed) == len(test_string) and typed == test_string:
            break
        
        # Check if a key has been pressed (non-blocking check using msvcrt.kbhit)
        if msvcrt.kbhit():
            key = msvcrt.getch()  # Read the key (this is blocking but we know key is available)
            
            # Handle different key types
            if key == b'\x08':  # Backspace key
                if len(typed) > 0:
                    # Remove last character and update display
                    typed = typed[:-1]
                    display_progress(test_string, typed)
            elif key == b'\x03':  # Ctrl+C - user wants to quit
                print("\n\nTest cancelled.")
                sys.exit(0)
            elif len(key) == 1 and 32 <= ord(key) <= 126:  # Printable ASCII characters
                char = key.decode('utf-8')
                
                # Ignore space if it's the first keypress
                # This prevents accidentally starting the test with a space
                if len(typed) == 0 and char == ' ':
                    continue
                
                # Start timer on first character typed (not when test starts)
                # This gives a fair WPM measurement regardless of when user starts typing
                if start_time is None:
                    start_time = time.time()
                
                # Only add character if we haven't reached the end yet
                # (extra keypresses after completion are ignored)
                if len(typed) < len(test_string):
                    typed += char
                    
                    # Check if this character is correct by comparing to the target
                    is_correct = (typed[-1] == test_string[len(typed) - 1])
                    
                    # Track character positions that were ever wrong
                    # Even if you backspace and correct it, we remember the mistake
                    if not is_correct:
                        char_ever_wrong.add(len(typed) - 1)
                        # Add the target character (what should have been typed) to mistyped string
                        global MISTYPED_CHARS
                        MISTYPED_CHARS += test_string[len(typed) - 1]
                        # Trim the string if it exceeds 1100 characters
                        if len(MISTYPED_CHARS) > 1100:
                            MISTYPED_CHARS = MISTYPED_CHARS[-1000:]
                    
                    # Update display with color coding
                    display_progress(test_string, typed, not is_correct)
    
    # Test is complete - now calculate results
    # Determine which words had errors by checking if any character in that word was ever wrong
    words = test_string.split()
    word_results = []
    char_index = 0  # Track position in the test string
    
    for word in words:
        # Check if any character in this word was ever typed incorrectly
        word_had_error = False
        for i in range(len(word)):
            if char_index + i in char_ever_wrong:
                word_had_error = True
                break
        
        # True means no error (success), False means there was an error
        word_results.append(not word_had_error)
        
        # Move to next word (account for the space after each word except the last)
        char_index += len(word) + 1
    
    # Calculate WPM (Words Per Minute)
    # Standard WPM calculation: (characters / 5) / minutes
    # We divide by 5 because the average English word is 5 characters
    elapsed_time = time.time() - start_time
    elapsed_minutes = elapsed_time / 60
    num_chars = len(test_string)
    wpm = (num_chars / 5) / elapsed_minutes
    
    # Check if any typing errors occurred across all words
    had_errors = any(word_results[i] == False for i in range(len(word_results)))
    
    # Determine if test passed based on requirements
    # Two independent criteria:
    # 1. WPM: must meet or exceed current_wpm_threshold
    # 2. Errors: must have no errors unless ALLOW_ERROR is True
    wpm_passed = (current_wpm_threshold is None or wpm >= current_wpm_threshold)
    error_passed = (OPTIONS['ALLOW_ERROR'] or not had_errors)
    test_passed = wpm_passed and error_passed  # Both must be true to pass
    
    # Display results to user with color-coded feedback
    if test_passed:
        # Success message in green
        print(f"\n{Fore.GREEN} Completed!{Style.RESET_ALL}, Time: {elapsed_time:.2f} seconds, WPM: {wpm:.2f}")
    else:
        # Failure message in yellow with specific reasons
        # Build message incrementally to show which requirements weren't met
        message = f"\n{Fore.YELLOW} Try again!{Style.RESET_ALL}, Time: {elapsed_time:.2f} seconds, WPM: {wpm:.2f}"
        if not wpm_passed:
            message += f", {Fore.YELLOW}WPM too low (need {current_wpm_threshold:.2f}){Style.RESET_ALL}"
        if not error_passed:
            message += f", {Fore.YELLOW}Errors not allowed{Style.RESET_ALL}"
        print(message)
    
    # Display per-word statistics: before -> delta -> after
    # This shows the user how their performance on each word changed
    # First, calculate the delta (changes from this test only)
    unique_words = list(set(word.lower() for word in words))
    word_stats = {}  # {word: [successes, failures]} for this test only
    
    # Count successes and failures for each word in this test
    for word, success in zip(words, word_results):
        word_lower = word.lower()
        if word_lower not in word_stats:
            word_stats[word_lower] = [0, 0]      
        if success:
            word_stats[word_lower][0] += 1  # Increment successes
        else:
            word_stats[word_lower][1] += 1  # Increment failures
    
    # Display before, delta, and after for each unique word in the test
    # Format: 'word': [before_s, before_f] + [delta_s, delta_f] -> [after_s, after_f]
    for word in unique_words:
        if word in WORD_DATA:
            before_s, before_f = WORD_DATA[word]
        else:
            before_s, before_f = 0, 0
        delta_s, delta_f = word_stats.get(word, [0, 0])
        # Calculate after values (what they'll be after update)
        after_s = before_s + delta_s
        after_f = before_f + delta_f
        print(f"  '{word}': [{before_s}, {before_f}] + [{delta_s}, {delta_f}] -> [{after_s}, {after_f}]")
    
    # Always update word statistics (even if test didn't pass)
    # This ensures we track all attempts, not just successful ones
    update_word_stats(words, word_results)
    
    time.sleep(1)  # Brief pause before starting next test (gives user time to read results)
    
    # Return all the test results for the calling function to process
    return test_passed, wpm, error_passed, wpm_passed, words, word_results


def run_typing_test():
    """Run the typing test loop.
    
    This is the main control loop that:
    1. Selects words to practice (using the Beta-Binomial model)
    2. Runs tests with those words
    3. Repeats failed tests with progressive WPM reduction
    4. Moves on to new words after passing or hitting max attempts
    
    The loop structure:
    - Outer loop: infinite, generates new test strings forever
    - Inner loop: retries the same test string until passed or MAX_TEST_REPEAT reached
    """
    while True:  # Outer loop: keep generating new tests indefinitely
        # Select new words to practice based on global options
        # This uses the Beta-Binomial model to prioritize words with lower success rates
        practice_words = select_words_to_practice(OPTIONS['NUM_WORDS'], OPTIONS['MIN_WORD_LENGTH'], OPTIONS['MAX_WORD_LENGTH'])
        
        # Repeat the words according to REPETITION setting
        # For example: ["cat", "dog", "rat"] with REPETITION=3 becomes
        # ["cat", "dog", "rat", "cat", "dog", "rat", "cat", "dog", "rat"]
        repeated_words = (practice_words * OPTIONS['REPETITION'])
        test_string = " ".join(repeated_words)
        
        # Initialize threshold and attempt counter for this specific test string
        # The threshold may be reduced during retry attempts (progressive difficulty)
        current_wpm_threshold = OPTIONS['MIN_WPM']
        attempt_count = 0
        
        # Inner loop: keep attempting the same test string until passed or max attempts reached
        while attempt_count < OPTIONS['MAX_TEST_REPEAT']:
            # Run a single test iteration and get detailed results
            test_passed, wpm, error_passed, wpm_passed, words, word_results = run_single_typing_test(
                test_string, current_wpm_threshold
            )
            
            if test_passed:
                # Test passed! Move on to next test string (break inner loop)
                break
            
            # Test failed - increment attempt count and potentially retry
            attempt_count += 1
            
            # Check if we've reached the maximum number of attempts
            if attempt_count >= OPTIONS['MAX_TEST_REPEAT']:
                print(f"{Fore.YELLOW}Moving on after {OPTIONS['MAX_TEST_REPEAT']} attempts...{Style.RESET_ALL}")
                break  # Give up on this test string, move to new words
            
            # Progressive difficulty: if failed due to WPM only (no typing errors), reduce the WPM threshold
            # This makes the test easier to pass if the user is typing accurately but too slowly
            if error_passed and not wpm_passed and OPTIONS['WPM_REDUCTION'] > 0:
                current_wpm_threshold = max(0, current_wpm_threshold - OPTIONS['WPM_REDUCTION'])
                print(f"{Fore.CYAN}Reducing WPM threshold to {current_wpm_threshold:.2f}{Style.RESET_ALL}")


def display_info():
    """Display typing statistics: character error distribution and worst words."""
    global WORD_DATA, MISTYPED_CHARS
    
    print("=" * 60)
    print("TYPING STATISTICS")
    print("=" * 60)
    
    # Character error distribution
    print("\n" + Fore.CYAN + "Character Error Distribution:" + Style.RESET_ALL)
    print("-" * 60)
    
    if len(MISTYPED_CHARS) == 0:
        print("No mistyped characters recorded yet.")
    else:
        # Count frequency of each character in mistyped list
        char_counts = {}
        for char in MISTYPED_CHARS:
            char_counts[char] = char_counts.get(char, 0) + 1
        
        # Calculate percentages and sort by count (descending)
        total = len(MISTYPED_CHARS)
        char_percentages = [(char, count, (count / total) * 100) 
                           for char, count in char_counts.items()]
        char_percentages.sort(key=lambda x: x[1], reverse=True)
        
        # Display character statistics
        for char, count, percentage in char_percentages:
            # Show space as a visible character
            display_char = '␣' if char == ' ' else char
            print(f"  '{display_char}': {percentage:5.2f}% ({count}/{total})")
    
    # Top 20 worst words by success probability
    print("\n" + Fore.CYAN + "Top 20 Most Problematic Words:" + Style.RESET_ALL)
    print("-" * 60)
    
    if len(WORD_DATA) == 0:
        print("No word statistics recorded yet.")
    else:
        # Calculate success probability for each word using same Beta-Binomial model
        alpha, beta = 1, 9
        word_probabilities = []
        
        for word, stats in WORD_DATA.items():
            success = stats[0]
            failure = stats[1]
            total_attempts = success + failure
            
            # Only include words that have been attempted
            if total_attempts > 0:
                # Beta-Binomial posterior mean formula
                numerator = alpha + success
                denominator = alpha + beta + success + failure
                p = numerator / denominator
                word_probabilities.append((word, p, success, failure, total_attempts))
        
        # Sort by probability (ascending - lowest/worst first)
        word_probabilities.sort(key=lambda x: x[1])
        
        # Display top 20 worst words
        for i, (word, prob, success, failure, total) in enumerate(word_probabilities[:20], 1):
            print(f"  {i:2d}. '{word}': {prob*100:5.2f}% success rate ({success}/{total} correct)")
    
    print("\n" + "=" * 60)


def main():
    """Main entry point for the typing test application.
    
    This function:
    1. Parses command line arguments
    2. Applies any configuration overrides (e.g., --3g mode)
    3. Loads word data from files
    4. Starts the main test loop
    5. Handles graceful shutdown on Ctrl+C
    """
    global WORD_DATA, OPTIONS
    
    # Parse command line arguments using argparse
    parser = argparse.ArgumentParser(description='Typing test application')
    parser.add_argument('--3g', action='store_true', dest='three_letter_mode',
                        help='Use 3-letter word mode (2 words x 5 repetitions)')
    parser.add_argument('--info', action='store_true',
                        help='Display typing statistics and exit')
    args = parser.parse_args()
    
    # Load words from word_list.txt and statistics from word_data.json
    # This also initializes word_data.json if it doesn't exist
    WORD_DATA = load_words()
    
    # If --info flag is provided, display statistics and exit
    if args.info:
        display_info()
        sys.exit(0)
    
    # Apply 3-letter word mode if requested via --3g flag
    # This mode uses shorter words with more repetitions, good for practicing trigrams
    if args.three_letter_mode:
        OPTIONS['MIN_WORD_LENGTH'] = 3
        OPTIONS['MAX_WORD_LENGTH'] = 3
        OPTIONS['NUM_WORDS'] = 2
        OPTIONS['REPETITION'] = 5
        print("Using 3-letter word mode (2 words x 5 repetitions)")
    
    try:
        # Display welcome message
        print("=" * 50)
        print("Welcome to the Typing Test!")
        print("=" * 50)
        
        # Start the main typing test loop (this runs indefinitely)
        run_typing_test()
    except KeyboardInterrupt:
        # Handle Ctrl+C gracefully - save data and exit cleanly
        print("\n\nTest cancelled. Goodbye!")
        sys.exit(0)


# Standard Python idiom: only run main() if this file is executed directly
# (not if it's imported as a module)
if __name__ == "__main__":
    main()
